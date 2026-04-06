const express = require('express');
const dotenv = require('dotenv');

// Load env vars FIRST
dotenv.config();

const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const connectDB = require('./src/config/db');
const errorHandler = require('./src/middleware/errorHandler');
const publicRoutes = require('./src/routes/public');
const adminRoutes  = require('./src/routes/admin');
const paymentV2Routes = require('./src/routes/paymentV2');
const { initializeSocket } = require('./src/services/socketService');
const { seedPricingConfig } = require('./src/models/PricingConfig');
const { registerPhase2UnlockJob } = require('./src/jobs/phase2Unlock');

const app = express();

// Request ID tracking
app.use((req, res, next) => {
  req.id = uuidv4();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// HTTPS enforcement (production — behind ALB / reverse proxy)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// CORS - support multiple origins
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', generalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/admin/auth/login', authLimiter);
app.use('/api/public/auth/login', authLimiter);
app.use('/api/public/auth/register', authLimiter);

// OTP send rate limiter — stricter: 3 per minute per IP
const otpSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { success: false, message: 'Too many OTP requests. Please wait 60 seconds.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/public/verification/email/send', otpSendLimiter);
app.use('/api/public/verification/phone/send', otpSendLimiter);

// Logging
morgan.token('id', (req) => req.id);
app.use(morgan(':id :method :url :status :response-time ms'));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// Static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount routes
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);
// V2 payment flow (plan Section 4) — sits alongside legacy /api/public/payments during transition
app.use('/api/payment', paymentV2Routes);
// Note: admin upload routes are mounted inside adminRoutes index.js — no separate mount needed.
// Root
app.get('/', (req, res) => {
  res.json({ success: true, message: 'Viramah API Server', version: '1.0.0' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Connect DB first, THEN start server
const start = async () => {
  await connectDB();

  // Ensure PricingConfig singleton exists in DB
  await seedPricingConfig();

  // Create HTTP server and attach Socket.IO
  const server = http.createServer(app);
  initializeSocket(server);

  // Phase 2 unlock scheduler — runs daily at 00:01 AM IST (Plan Section 8)
  registerPhase2UnlockJob();

  server.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`${signal} received. Shutting down gracefully...`);
    server.close(() => {
      const mongoose = require('mongoose');
      mongoose.connection.close(false).then(() => {
        console.log('Database connection closed.');
        process.exit(0);
      }).catch((err) => {
        console.error('Error closing database:', err);
        process.exit(1);
      });
    });
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  // Exit to prevent the server from running in an undefined state.
  // The process manager (PM2, Docker, etc.) will restart it.
  process.exit(1);
});

start();

module.exports = app;
