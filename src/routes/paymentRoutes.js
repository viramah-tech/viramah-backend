const express = require("express");
const Joi = require("joi");
const auth = require("../middleware/auth");
const stepGate = require("../middleware/stepGate");
const validate = require("../middleware/validate");
const paymentService = require("../services/paymentService");

const router = express.Router();

const bookingSchema = Joi.object({
  method: Joi.string().valid("upi", "bank_transfer", "cash").required(),
  transactionId: Joi.string().min(3).max(80).required(),
  proofUrl: Joi.string().uri().required(),
  amount: Joi.number().min(1).required(),
});

const finalSchema = Joi.object({
  category: Joi.string().valid("room_rent", "mess", "transport", "security_deposit").required(),
  method: Joi.string().valid("upi", "bank_transfer", "cash").required(),
  transactionId: Joi.string().min(3).max(80).required(),
  proofUrl: Joi.string().uri().required(),
  amount: Joi.number().min(1).required(),
  planType: Joi.string().valid("full", "half").optional(),
});

const lifecycleReasonSchema = Joi.object({
  reason: Joi.string().trim().max(500).allow("", null).optional(),
});

router.post(
  "/booking",
  auth,
  stepGate("booking_payment"),
  validate(bookingSchema),
  async (req, res, next) => {
    try {
      const payment = await paymentService.submitBookingPayment(req.user, req.validatedBody);
      res.status(201).json({ success: true, data: { payment } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/final",
  auth,
  stepGate("final_payment", "completed"),
  validate(finalSchema),
  async (req, res, next) => {
    try {
      const payment = await paymentService.submitFinalPayment(req.user, req.validatedBody);
      res.status(201).json({ success: true, data: { payment } });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/status",
  auth,
  stepGate("booking_payment", "final_payment", "completed"),
  async (req, res, next) => {
    try {
      const result = await paymentService.getPaymentStatus(req.user);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/extension-request",
  auth,
  stepGate("final_payment"),
  validate(lifecycleReasonSchema),
  async (req, res, next) => {
    try {
      const result = await paymentService.requestPaymentDeadlineExtension(req.user, req.validatedBody);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/refund-request",
  auth,
  stepGate("final_payment"),
  validate(lifecycleReasonSchema),
  async (req, res, next) => {
    try {
      const result = await paymentService.requestBookingRefund(req.user, req.validatedBody);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/cancel-booking",
  auth,
  stepGate("booking_payment", "final_payment"),
  validate(lifecycleReasonSchema),
  async (req, res, next) => {
    try {
      const result = await paymentService.requestBookingCancellation(req.user, req.validatedBody);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/upgrade-plan",
  auth,
  stepGate("completed", "final_payment"),
  async (req, res, next) => {
    try {
      const result = await paymentService.upgradePaymentPlan(req.user);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
