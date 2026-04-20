const express = require("express");
const Joi = require("joi");
const auth = require("../middleware/auth");
const stepGate = require("../middleware/stepGate");
const validate = require("../middleware/validate");
const verificationService = require("../services/verificationService");

const router = express.Router();

const verifyOtpSchema = Joi.object({
  otp: Joi.string().length(6).pattern(/^[0-9]+$/).required(),
});

router.post("/send-otp", auth, stepGate("verification"), async (req, res, next) => {
  try {
    const result = await verificationService.sendOtp(req.user);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/verify-otp",
  auth,
  stepGate("verification"),
  validate(verifyOtpSchema),
  async (req, res, next) => {
    try {
      const result = await verificationService.verifyOtp(req.user, req.validatedBody.otp);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
