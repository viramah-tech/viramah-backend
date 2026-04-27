const express = require("express");
const Joi = require("joi");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const validate = require("../middleware/validate");
const adminService = require("../services/adminService");
const { logAdminAction } = require("../utils/auditLogger");

const router = express.Router();

// Apply auth and role guard to ALL routes
router.use(auth, roleGuard("admin"));

// Add additional verification that user is still admin (defense in depth)
router.use((req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      error: { message: "Insufficient permissions", code: "FORBIDDEN" },
    });
  }
  next();
});

const rejectSchema = Joi.object({ reason: Joi.string().min(3).max(500).required() });

const pricingSchema = Joi.object({
  tenureMonths: Joi.number().integer().min(1).max(60),
  registrationFee: Joi.number().integer().min(0),
  securityDeposit: Joi.number().integer().min(0),
  mess: Joi.object({
    monthlyFee: Joi.number().integer().min(0),
    annualDiscountedPrice: Joi.number().integer().min(0),
  }),
  transport: Joi.object({
    monthlyFee: Joi.number().integer().min(0),
  }),
  bookingPayment: Joi.object({
    minimumAmount: Joi.number().integer().min(0),
    suggestedAmount: Joi.number().integer().min(0),
  }),
  paymentDeadlineDays: Joi.number().integer().min(1).max(365),
  defaultFullPaymentDiscountPct: Joi.number().min(0).max(100),
  defaultHalfPaymentDiscountPct: Joi.number().min(0).max(100),
}).min(1);

const roomTypeSchema = Joi.object({
  name: Joi.string().valid("Axis+", "Axis", "Collective", "Nexus").required(),
  capacity: Joi.number().integer().min(1).required(),
  features: Joi.array().items(Joi.string()).default([]),
  basePrice: Joi.number().integer().min(0).required(),
  totalRooms: Joi.number().integer().min(0).default(0),
  availableRooms: Joi.number().integer().min(0).default(0),
  isActive: Joi.boolean().default(true),
});

const roomTypeUpdateSchema = roomTypeSchema.fork(Object.keys(roomTypeSchema.describe().keys), (s) =>
  s.optional()
);

router.get("/users", async (req, res, next) => {
  try {
    const { status, step, page, limit } = req.query;
    const result = await adminService.getUsers({ status, step, page, limit });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Must be before /users/:userId to avoid :userId capturing "export"
router.get("/users/export", async (req, res, next) => {
  try {
    const result = await adminService.getUsers({ page: 1, limit: 1000 });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/users/:userId/status",
  validate(Joi.object({ status: Joi.string().valid("pending", "active", "suspended", "blocked").required() })),
  async (req, res, next) => {
    try {
      const result = await adminService.updateUserStatus(req.params.userId, req.validatedBody.status);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.put("/users/:userId/verify-documents", async (req, res, next) => {
  try {
    const result = await adminService.verifyUserDocuments(req.params.userId, req.user.basicInfo.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/users/:userId/reject-documents",
  validate(Joi.object({ reason: Joi.string().min(3).max(500).required() })),
  async (req, res, next) => {
    try {
      const result = await adminService.rejectUserDocuments(
        req.params.userId,
        req.user.basicInfo.userId,
        req.validatedBody.reason
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.put("/users/:userId/move-in", async (req, res, next) => {
  try {
    const result = await adminService.completeMoveIn(req.params.userId, req.user.basicInfo.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get("/users/:userId", async (req, res, next) => {
  try {
    const user = await adminService.getUserById(req.params.userId);
    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:userId", async (req, res, next) => {
  try {
    await adminService.deleteUser(req.params.userId, req.user.basicInfo.userId);
    res.json({ success: true, message: "User deleted successfully" });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/users/:userId/discounts",
  validate(
    Joi.object({
      fullPaymentDiscountPct: Joi.number().min(0).max(100),
      halfPaymentDiscountPct: Joi.number().min(0).max(100),
      customRackRate: Joi.number().min(0),
    }).min(1)
  ),
  async (req, res, next) => {
    try {
      const { fullPaymentDiscountPct, halfPaymentDiscountPct, customRackRate } = req.validatedBody;
      const roomRent = await adminService.updateRoomRentDiscounts(
        req.params.userId,
        fullPaymentDiscountPct,
        halfPaymentDiscountPct,
        customRackRate
      );
      res.json({ success: true, data: { roomRent } });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/payments", async (req, res, next) => {
  try {
    const { status } = req.query;
    const payments = await adminService.getPayments(status);
    res.json({ success: true, data: { payments } });
  } catch (err) {
    next(err);
  }
});

router.put("/payments/:userId/:paymentId/approve", async (req, res, next) => {
  try {
    const result = await adminService.approvePayment(
      req.params.userId,
      req.params.paymentId,
      req.user.basicInfo.userId
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/payments/:userId/:paymentId/reject",
  validate(rejectSchema),
  async (req, res, next) => {
    try {
      const result = await adminService.rejectPayment(
        req.params.userId,
        req.params.paymentId,
        req.user.basicInfo.userId,
        req.validatedBody.reason
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/dashboard", async (req, res, next) => {
  try {
    const stats = await adminService.getDashboard();
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

router.put("/pricing", validate(pricingSchema), async (req, res, next) => {
  try {
    const pricing = await adminService.updatePricing(req.validatedBody);
    res.json({ success: true, data: { pricing } });
  } catch (err) {
    next(err);
  }
});

router.post("/room-types", validate(roomTypeSchema), async (req, res, next) => {
  try {
    const room = await adminService.createRoomType(req.validatedBody);
    res.status(201).json({ success: true, data: { room } });
  } catch (err) {
    next(err);
  }
});

router.put("/room-types/:id", validate(roomTypeUpdateSchema), async (req, res, next) => {
  try {
    const room = await adminService.updateRoomType(req.params.id, req.validatedBody);
    res.json({ success: true, data: { room } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
