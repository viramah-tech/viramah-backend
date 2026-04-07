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

// NOTE: POST /initiate removed — resident payment submission migrated to
// /api/payment/submit (paymentSubmitController). Read-only resident endpoints
// (my-payments, upcoming, :id) remain until payment-status/page.tsx migrates.

// ── My Payments ───────────────────────────────────────────────────────────────
router.get('/my-payments', getMyPayments);

// ── Upcoming Installments ────────────────────────────────────────────────────
router.get('/upcoming', getUpcomingInstallments);

// ── Single Payment ─────────────────────────────────────────────────────────────
router.get('/:id', getPaymentById);

module.exports = router;
