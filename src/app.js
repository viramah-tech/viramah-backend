const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const createSessionMiddleware = require("./config/session");
const { AppError } = require("./utils/errors");

const app = express();

app.set("trust proxy", 1);
app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map(o => o.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS policy violation"));
      }
    },
    credentials: true,
  })
);

const jsonRateLimitHandler = (message = "Too many requests, please try again later.") =>
  (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        message,
        code: "RATE_LIMITED",
      },
    });
  };

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler("Too many login attempts. Please try again later."),
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler("Too many OTP requests. Please try again later."),
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler(),
});

app.use(globalLimiter);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(createSessionMiddleware());

app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Viramah API is running" });
});

// Routes
const authRoutes = require("./routes/authRoutes");
const verificationRoutes = require("./routes/verificationRoutes");
const onboardingRoutes = require("./routes/onboardingRoutes");
const roomRoutes = require("./routes/roomRoutes");
const pricingRoutes = require("./routes/pricingRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const adminRoutes = require("./routes/adminRoutes");

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/public/auth", authLimiter, authRoutes);
app.use("/api/verify", otpLimiter, verificationRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);

// 404
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: { message: "Route not found", code: "NOT_FOUND" },
  });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof AppError && err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: { message: err.message, code: err.code },
    });
  }

  // Multer / file size errors
  if (err && err.name === "MulterError") {
    return res.status(400).json({
      success: false,
      error: { message: err.message, code: "UPLOAD_ERROR" },
    });
  }

  const errorMessage = process.env.NODE_ENV === "production" 
    ? "Internal Server Error (" + (err?.message || "Unknown error") + ")"
    : (err?.message || "Internal Server Error");
  
  console.error("[ERROR]", {
    timestamp: new Date().toISOString(),
    message: err?.message,
    code: err?.code,
    stack: err?.stack,
    path: req.path,
  });
  
  res.status(500).json({
    success: false,
    error: { 
      message: errorMessage, 
      code: "INTERNAL_ERROR",
      stack: process.env.NODE_ENV === "production" ? err?.stack : undefined 
    },
  });
});

module.exports = app;
