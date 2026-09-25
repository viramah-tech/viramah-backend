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

// Allow localhost, LAN IPs (for mobile testing), and amplifyapp.com / viramahstay.com subdomains
const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  // In development or local testing, allow any localhost, 127.0.0.1, or local network IP on any port
  if (process.env.NODE_ENV !== "production") {
    if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)) {
      return true;
    }
  }

  // Allow all amplifyapp.com and viramahstay.com subdomains
  if (/^https:\/\/([a-zA-Z0-9-]+\.)?amplifyapp\.com$/.test(origin) ||
      /^https:\/\/([a-zA-Z0-9-]+\.)?viramahstay\.com$/.test(origin)) {
    return true;
  }

  return false;
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy violation for origin: ${origin}`));
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
  max: 3000,
  skip: (req) => req.path.includes("/attendance") || req.path.includes("/iclock") || req.path.includes("/cdata"),
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler(),
});

app.use(globalLimiter);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.text({ type: "text/plain", limit: "2mb" }));
const { getResolvedMongoUri } = require("./config/db");
app.use(createSessionMiddleware(getResolvedMongoUri()));

// Support Bearer Token / Header-based Session ID for mobile browsers where third-party cookies are blocked (ITP / Privacy Sandbox)
app.use(async (req, res, next) => {
  if (!req.session?.userId) {
    const authHeader = req.headers.authorization;
    const token = (authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null) || req.headers["x-session-id"];
    if (token && req.sessionStore) {
      try {
        await new Promise((resolve) => {
          req.sessionStore.get(token, (err, sessionData) => {
            if (!err && sessionData && sessionData.userId) {
              req.session = Object.assign(req.session || {}, sessionData);
              req.sessionID = token;
            }
            resolve();
          });
        });
      } catch (err) {
        console.error("[SESSION_TOKEN_RESTORE_ERROR]", err);
      }
    }
  }
  next();
});

// Debug request/response logger — placed AFTER session middleware so req.session is populated
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.path} | Origin: ${req.headers.origin || "none"} | Cookie: ${req.headers.cookie ? "yes" : "no"} | SessionID: ${req.sessionID || "none"} | UserId: ${req.session?.userId || "none"}`);
  res.on("finish", () => {
    console.log(`[RES] ${req.method} ${req.path} -> ${res.statusCode} | Set-Cookie: ${res.getHeader("set-cookie") ? "yes" : "none"}`);
  });
  next();
});

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
const websiteRoutes = require("./routes/websiteRoutes");
const salesRoutes = require("./routes/salesRoutes");
const emailRoutes = require("./routes/emailRoutes");
const messRoutes = require("./routes/messRoutes");
const transportRoutes = require("./routes/transportRoutes");

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/public/auth", authLimiter, authRoutes);
app.use("/api/verify", otpLimiter, verificationRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/emails", emailRoutes);
app.use("/api/website", websiteRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/mess", messRoutes);
app.use("/api/transport", transportRoutes);

const maintenanceRoutes = require("./routes/maintenanceRoutes");
app.use("/api/maintenance", maintenanceRoutes);

const attendanceRoutes = require("./routes/attendanceRoutes");
app.use("/api/admin/attendance", attendanceRoutes);

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

  // Multer / file upload stream errors
  if (err && (err.name === "MulterError" || err.message?.includes("Unexpected end of form"))) {
    return res.status(400).json({
      success: false,
      error: { message: err.message || "File upload stream error", code: "UPLOAD_ERROR" },
    });
  }

  // Express body parser payload size limit error
  if (err && (err.type === "entity.too.large" || err.status === 413)) {
    return res.status(413).json({
      success: false,
      error: { message: "Request payload size exceeds maximum allowed limit", code: "PAYLOAD_TOO_LARGE" },
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
