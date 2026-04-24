const express = require("express");
const Joi = require("joi");
const auth = require("../middleware/auth");
const stepGate = require("../middleware/stepGate");
const validate = require("../middleware/validate");
const { upload } = require("../middleware/upload");
const onboardingService = require("../services/onboardingService");

const router = express.Router();

const complianceSchema = Joi.object({
  termsAccepted: Joi.boolean().valid(true).required(),
  privacyPolicyAccepted: Joi.boolean().valid(true).required(),
  termsVersion: Joi.string().default("1.0"),
  privacyVersion: Joi.string().default("1.0"),
});

const personalSchema = Joi.object({
  fullName: Joi.string().min(2).max(120).required(),
  dateOfBirth: Joi.date().iso().required(),
  gender: Joi.string().valid("male", "female", "other").required(),
  address: Joi.string().min(10).max(500).required(),
  idType: Joi.string()
    .valid("aadhaar", "pan", "passport", "driving_license", "voter_id")
    .required(),
  idNumber: Joi.string().min(4).max(32).required(),
});

const guardianSchema = Joi.object({
  fullName: Joi.string().min(2).max(120).required(),
  relation: Joi.string().min(2).max(40).required(),
  phone: Joi.string().pattern(/^[0-9+\- ]{7,15}$/).required(),
  alternatePhone: Joi.string()
    .pattern(/^[0-9+\- ]{7,15}$/)
    .allow("", null)
    .optional(),
  idType: Joi.string()
    .valid("aadhaar", "pan", "passport", "driving_license", "voter_id")
    .required(),
  idNumber: Joi.string().min(4).max(32).required(),
});

const roomSchema = Joi.object({
  roomTypeId: Joi.string().hex().length(24).required(),
  includeMess: Joi.boolean().default(false),
  includeTransport: Joi.boolean().default(false),
  paymentPlan: Joi.string().valid("full", "half").required(),
});

router.put(
  "/compliance",
  auth,
  stepGate("compliance"),
  validate(complianceSchema),
  async (req, res, next) => {
    try {
      const result = await onboardingService.saveCompliance(req.user, req.validatedBody);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/personal",
  auth,
  stepGate("personal_details"),
  upload.fields([
    { name: "profilePhoto", maxCount: 1 },
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 },
  ]),
  validate(personalSchema),
  async (req, res, next) => {
    try {
      const result = await onboardingService.savePersonalDetails(
        req.user,
        req.validatedBody,
        req.files
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/guardian",
  auth,
  stepGate("guardian_details"),
  upload.fields([
    { name: "guardianIdFront", maxCount: 1 },
    { name: "guardianIdBack", maxCount: 1 },
  ]),
  validate(guardianSchema),
  async (req, res, next) => {
    try {
      const result = await onboardingService.saveGuardianDetails(
        req.user,
        req.validatedBody,
        req.files
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/room",
  auth,
  stepGate("room_selection", "review"),
  validate(roomSchema),
  async (req, res, next) => {
    try {
      const result = await onboardingService.saveRoomSelection(req.user, req.validatedBody);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/review", auth, stepGate("review"), async (req, res, next) => {
  try {
    const result = await onboardingService.getReview(req.user);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/confirm", auth, stepGate("review"), async (req, res, next) => {
  try {
    const result = await onboardingService.confirmReview(req.user);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.put("/phone", auth, stepGate("verification", "compliance"), async (req, res, next) => {
  try {
    const phoneSchema = Joi.object({ phone: Joi.string().pattern(/^[0-9+\- ]{7,15}$/).required() });
    const { error, value } = phoneSchema.validate(req.body);
    if (error) throw new Error(error.message);
    
    const result = await onboardingService.savePhone(req.user, value);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
