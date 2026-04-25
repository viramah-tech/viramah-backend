const express = require("express");
const Joi = require("joi");
const authService = require("../services/authService");
const validate = require("../middleware/validate");
const auth = require("../middleware/auth");

const router = express.Router();

const registerSchema = Joi.object({
  name: Joi.string().max(100).optional(),
  email: Joi.string().email().required(),
  phone: Joi.string().pattern(/^[0-9+\- ]{7,15}$/).optional(),
  password: Joi.string().min(8).max(128).required(),
  salesAgent: Joi.string().max(100).optional().allow(""),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

router.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    const user = await authService.register(req.validatedBody);
    req.session.userId = user.basicInfo.userId;
    req.session.role = user.role;
    // Explicitly save session before sending response
    req.session.save((err) => {
      if (err) return next(err);
      res.status(201).json({ success: true, data: { user } });
    });
  } catch (err) {
    next(err);
  }
});

router.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    const user = await authService.login(req.validatedBody);
    req.session.userId = user.basicInfo.userId;
    req.session.role = user.role;
    // Explicitly save session before sending response
    req.session.save((err) => {
      if (err) return next(err);
      res.json({ success: true, data: { user } });
    });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", auth, async (req, res, next) => {
  try {
    await authService.logout(req.session);
    res.clearCookie("connect.sid");
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/me", auth, async (req, res, next) => {
  try {
    const user = await authService.getMe(req.session.userId);
    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

const forgotSendOtpSchema = Joi.object({ email: Joi.string().email().required() });
const forgotVerifyOtpSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).pattern(/^\d+$/).required(),
});
const forgotResetSchema = Joi.object({
  email: Joi.string().email().required(),
  newPassword: Joi.string().min(8).max(128).required(),
});

router.post("/forgot-password/send-otp", validate(forgotSendOtpSchema), async (req, res, next) => {
  try {
    const result = await authService.forgotPasswordSendOtp(req.validatedBody.email);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/forgot-password/verify-otp", validate(forgotVerifyOtpSchema), async (req, res, next) => {
  try {
    await authService.forgotPasswordVerifyOtp(req.validatedBody.email, req.validatedBody.otp);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/forgot-password/reset", validate(forgotResetSchema), async (req, res, next) => {
  try {
    await authService.resetPassword(req.validatedBody.email, req.validatedBody.newPassword);
    res.json({ success: true, message: "Password reset successfully." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
