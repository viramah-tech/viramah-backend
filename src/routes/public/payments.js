'use strict';

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const { body, query } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect, optionalProtect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const {
  calculatePreview,
  getPricingConstants,
  initiatePayment,
  getMyPayments,
  getUpcomingInstallments,
  getPaymentById,
} = require('../../controllers/public/paymentController');

// ── Rate limiter for calculate-preview (10 req/min per IP) ─────────────────
// validate:false suppresses ERR_ERL_KEY_GEN_IPV6 in environments where
// trust proxy is not set (e.g. local dev without a reverse proxy).
const previewLimiter = rateLimit({
  windowMs:       60 * 1000,
  max:            10,
  message:        { success: false, message: 'Too many preview requests. Please wait 1 minute.' },
  standardHeaders: true,
  legacyHeaders:  false,
  validate:       { xForwardedForHeader: false, trustProxy: false },
});

const router = express.Router();

// ── Calculate Preview ─────────────────────────────────────────────────────────
// Auth-optional: can be called during onboarding before login.
// Rate limited to 10 req/min per IP.
router.get(
  '/calculate-preview',
  optionalProtect,
  previewLimiter,
  [
    query('roomTypeId').trim().notEmpty().withMessage('roomTypeId is required'),
    query('paymentMode')
      .isIn(['full', 'half'])
      .withMessage('paymentMode must be "full" or "half"'),
    query('messLumpSum')
      .optional()
      .custom((val, { req }) => {
        if ((val === 'true' || val === true) && req.query.paymentMode !== 'full') {
          throw new Error('messLumpSum is only valid when paymentMode is "full"');
        }
        if ((val === 'true' || val === true) && req.query.mess !== 'true') {
          throw new Error('messLumpSum requires mess add-on to be selected');
        }
        return true;
      }),
    query('referralCode')
      .optional({ nullable: true })
      .matches(/^VIR-[A-Z0-9]{6}$/i)
      .withMessage('Referral code format must be VIR-XXXXXX (6 alphanumeric chars)'),
  ],
  validate,
  calculatePreview
);

// AUDIT FIX D-1: Public pricing constants — no auth needed
router.get('/pricing-config', getPricingConstants);

// ── Protected routes — require resident auth ───────────────────────────────────
router.use(protect, authorize('user', 'resident'));

// ── Initiate Payment ──────────────────────────────────────────────────────────
router.post(
  '/initiate',
  [
    body('paymentMode')
      .isIn(['full', 'half'])
      .withMessage('paymentMode must be "full" or "half"'),
    body('addOns.transport')
      .optional()
      .isBoolean()
      .withMessage('addOns.transport must be a boolean'),
    body('addOns.mess')
      .optional()
      .isBoolean()
      .withMessage('addOns.mess must be a boolean'),
    body('addOns.messLumpSum')
      .optional()
      .isBoolean()
      .withMessage('addOns.messLumpSum must be a boolean')
      .custom((val, { req }) => {
        if (val === true || val === 'true') {
          if (req.body.paymentMode !== 'full') {
            throw new Error('messLumpSum is only valid when paymentMode is "full"');
          }
          if (!req.body.addOns?.mess) {
            throw new Error('messLumpSum requires mess add-on to also be selected');
          }
        }
        return true;
      }),
    body('referralCode')
      .optional({ nullable: true })
      .if(body('referralCode').notEmpty())
      .matches(/^VIR-[A-Z0-9]{6}$/i)
      .withMessage('Referral code must be in format VIR-XXXXXX'),
    body('paymentMethod')
      .trim()
      .notEmpty()
      .withMessage('paymentMethod is required'),
    body('transactionId')
      .optional({ nullable: true })
      .trim(),
    body('receiptUrl')
      .optional({ nullable: true })
      .trim(),
  ],
  validate,
  initiatePayment
);

// ── My Payments ───────────────────────────────────────────────────────────────
router.get('/my-payments', getMyPayments);

// ── Upcoming Installments ────────────────────────────────────────────────────
router.get('/upcoming', getUpcomingInstallments);

// ── Single Payment ─────────────────────────────────────────────────────────────
router.get('/:id', getPaymentById);

module.exports = router;
