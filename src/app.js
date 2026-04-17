const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const createSessionMiddleware = require("./config/session");

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  credentials: true,
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(createSessionMiddleware());

app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Viramah API is running" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({
    success: false,
    error: { message: err.message || "Internal Server Error", code: err.code || "INTERNAL_ERROR" },
  });
});

module.exports = app;
