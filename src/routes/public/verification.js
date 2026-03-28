const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const {
  sendEmailCode,
  verifyEmailCode,
  sendPhoneCode,
  verifyPhoneCode,
  getVerificationStatus,
} = require('../../controllers/public/verificationController');

const router = express.Router();

// All verification routes require authentication
router.use(protect, authorize('user'));

// ── Email Verification ──────────────────────────────────────────────────────

// POST /api/public/verification/email/send
router.post('/email/send', sendEmailCode);

// POST /api/public/verification/email/verify
router.post(
  '/email/verify',
  [
    body('otp')
      .trim()
      .notEmpty().withMessage('Verification code is required')
      .isLength({ min: 6, max: 6 }).withMessage('Code must be exactly 6 digits')
      .isNumeric().withMessage('Code must contain only digits'),
  ],
  validate,
  verifyEmailCode
);

// ── Phone Verification ──────────────────────────────────────────────────────

// POST /api/public/verification/phone/send
router.post(
  '/phone/send',
  [
    body('phone')
      .optional()
      .trim()
      .isLength({ min: 10 }).withMessage('Phone number must be at least 10 digits'),
  ],
  validate,
  sendPhoneCode
);

// POST /api/public/verification/phone/verify
router.post(
  '/phone/verify',
  [
    body('otp')
      .trim()
      .notEmpty().withMessage('Verification code is required')
      .isLength({ min: 6, max: 6 }).withMessage('Code must be exactly 6 digits')
      .isNumeric().withMessage('Code must contain only digits'),
  ],
  validate,
  verifyPhoneCode
);

// ── Status ──────────────────────────────────────────────────────────────────

// GET /api/public/verification/status
router.get('/status', getVerificationStatus);

module.exports = router;
