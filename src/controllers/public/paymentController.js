'use strict';

const paymentService  = require('../../services/payment-service');
const pricingService  = require('../../services/pricing-service');
const depositService  = require('../../services/deposit-service');
const User            = require('../../models/User');
const { success, error } = require('../../utils/apiResponse');
const { emitToAdmins, emitToUser } = require('../../services/socket-service');

// ── AUDIT FIX D-1: Public Pricing Constants ──────────────────────────────────

/**
 * GET /api/public/payments/pricing-config
 * Returns all public-facing pricing constants from PricingConfig model.
 * No auth required — needed during onboarding for dynamic deposit display.
 *
 * @route GET /api/public/payments/pricing-config
 * @access Public (no auth)
 */
const getPricingConstants = async (req, res, next) => {
  try {
    const config = await pricingService.getPricingConfig();
    if (!config) {
      return error(res, 'Pricing configuration not available', 503);
    }

    // Return only what frontend needs — never expose admin-only fields
    return success(res, {
      securityDeposit:    config.securityDeposit,
      registrationFee:    config.registrationFee,
      totalDepositPayment: config.securityDeposit + config.registrationFee,
      transportMonthly:   config.transportMonthly,
      messMonthly:        config.messMonthly,
      messLumpSum:        config.messLumpSum,
      discountFull:       config.discountFull,
      discountHalf:       config.discountHalf,
      referralBonus:      config.referralBonus,
      tenureMonths:       config.tenureMonths,
      gstRate:            config.gstRate ?? 0.12,
    }, 'Pricing config fetched');
  } catch (err) {
    next(err);
  }
};

// ── Calculate Preview (GET, rate-limited, auth-optional) ─────────────────────

/**
 * GET /api/public/payments/calculate-preview
 *
 * Returns a live pricing breakdown WITHOUT creating any records.
 * This is the ONLY way the frontend should display pricing numbers.
 * Query params: roomTypeId, paymentMode, transport, mess, messLumpSum, referralCode
 *
 * @route GET /api/public/payments/calculate-preview
 * @access Public (rate-limited)
 */
const calculatePreview = async (req, res, next) => {
  try {
    const {
      roomTypeId,
      paymentMode,
      transport    = 'false',
      mess         = 'false',
      referralCode = null,
    } = req.query;

    if (!roomTypeId) {
      return error(res, 'roomTypeId is required', 400);
    }
    if (!['full', 'half'].includes(paymentMode)) {
      return error(res, 'paymentMode must be "full" or "half"', 400);
    }

    const toBoolean = (v) => v === 'true' || v === true || v === '1';

    const addOns = {
      transport:   toBoolean(transport),
      mess:        toBoolean(mess),
      // messLumpSum is auto-derived by pricingService (full + mess = lump sum)
    };

    // For preview, currentUserId can be null (no referral deduction applied in that case)
    const currentUserId = req.user?._id?.toString() || 'preview-user';

    // Referral validation (non-fatal for preview — just exclude deduction if invalid)
    let validatedReferralCode = null;
    if (referralCode) {
      const refCheck = await pricingService.validateReferralCode(referralCode, currentUserId);
      if (refCheck.valid) {
        validatedReferralCode = referralCode;
      }
      // If invalid, proceed without referral — preview still works
    }

    // Check for active deposit credit — applies to preview so user sees correct amounts
    let depositCredit = 0;
    if (req.user?._id) {
      const depositInfo = await depositService.getDepositCredit(req.user._id.toString());
      depositCredit = depositInfo.creditAmount;
    }

    const calc = await pricingService.calculatePayment({
      roomTypeId,
      paymentMode,
      addOns,
      referralCode: validatedReferralCode,
      currentUserId,
      depositCredit,
    });

    return success(res, {
      breakdown:    calc.breakdown,
      breakdown2:   calc.breakdown2,
      installment1: calc.installment1,
      installment2: calc.installment2,
      paymentMode,
      schedule:     pricingService.getInstallmentSchedule(
        paymentMode,
        new Date(),
        calc.installment1,
        calc.installment2
      ),
    }, 'Price preview calculated successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

// initiatePayment removed — resident payment submission lives in
// controllers/public/paymentSubmitController.js (POST /api/payment/submit).

// ── Get My Payments (GET, auth required) ─────────────────────────────────────

/**
 * GET /api/public/payments/my-payments
 * Lists all payments (including upcoming installments) for the logged-in resident.
 *
 * @route GET /api/public/payments/my-payments
 * @access Private (resident)
 */
const getMyPayments = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const Payment = require('../../models/Payment');
    const [payments, total] = await Promise.all([
      Payment.find({ userId: req.user._id })
        .sort({ installmentNumber: 1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Payment.countDocuments({ userId: req.user._id }),
    ]);

    return success(res, {
      payments,
      pagination: {
        total,
        page:  Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    }, 'Payments fetched');
  } catch (err) {
    next(err);
  }
};

// ── Get Upcoming Installments (GET, auth required) ────────────────────────────

/**
 * GET /api/public/payments/upcoming
 * Returns pre-created 'upcoming' installment records for the resident.
 *
 * @route GET /api/public/payments/upcoming
 * @access Private (resident)
 */
const getUpcomingInstallments = async (req, res, next) => {
  try {
    const installments = await paymentService.getUpcomingInstallments(req.user._id.toString());
    return success(res, { installments }, 'Upcoming installments fetched');
  } catch (err) {
    next(err);
  }
};

// ── Get Payment By ID (GET, auth required) ────────────────────────────────────

/**
 * GET /api/public/payments/:id
 * Get a single payment that belongs to the logged-in resident.
 *
 * @route GET /api/public/payments/:id
 * @access Private (resident)
 */
const getPaymentById = async (req, res, next) => {
  try {
    const Payment = require('../../models/Payment');
    const payment = await Payment.findOne({
      _id:    req.params.id,
      userId: req.user._id,
    });

    if (!payment) return error(res, 'Payment not found', 404);

    return success(res, { payment }, 'Payment fetched');
  } catch (err) {
    next(err);
  }
};

// ── Validate Referral Code (GET, public) ──────────────────────────────────────

/**
 * GET /api/public/referral/validate/:code
 * Validates a referral code. Does NOT apply any credits — pure check only.
 *
 * @route GET /api/public/referral/validate/:code
 * @access Public (or Auth-optional)
 */
const validateReferral = async (req, res, next) => {
  try {
    const { code } = req.params;
    const currentUserId = req.user?._id?.toString() || 'anonymous';

    const result = await pricingService.validateReferralCode(code, currentUserId);

    return success(res, {
      valid:   result.valid,
      message: result.message,
    }, result.message);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  calculatePreview,
  getPricingConstants,
  getMyPayments,
  getUpcomingInstallments,
  getPaymentById,
  validateReferral,
};
