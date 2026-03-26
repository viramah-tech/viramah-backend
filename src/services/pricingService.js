'use strict';

/**
 * pricingService.js — SINGLE SOURCE OF TRUTH for all payment calculations.
 *
 * RULES:
 * - No controller, no frontend, no other service calculates amounts independently.
 * - All monetary math uses integer arithmetic (₹, no paise). Results rounded with Math.round().
 * - GST is applied only to room rent, using two-step rounding (per Indian GST standard):
 *     1. discountedBase = Math.round(roomMonthly × (1 - discountRate))
 *     2. gstAmount      = Math.round(discountedBase × gstRate)
 *     3. totalPerMonth  = discountedBase + gstAmount
 * - Security deposit and registration fee are FLAT charges (not discounted).
 *   They are included in installment 1 only.
 * - Transport and mess fees ARE discounted as part of the subtotal (per business spec).
 * - Referral deduction is applied AFTER all other calculations.
 */

const { PricingConfig } = require('../models/PricingConfig');
const RoomType = require('../models/RoomType');
const User = require('../models/User');

// ── Config Cache ──────────────────────────────────────────────────────────────
let _configCache = null;
let _cacheExpiresAt = 0;
const CONFIG_CACHE_TTL_MS = 60 * 1000; // 1 minute

/**
 * Fetches PricingConfig from DB (cached for 60 seconds).
 * @returns {Promise<Object>} Pricing configuration document
 */
const getPricingConfig = async () => {
  const now = Date.now();
  if (_configCache && now < _cacheExpiresAt) {
    return _configCache;
  }
  let config = await PricingConfig.findOne().lean();
  if (!config) {
    // Seed a default if somehow missing at runtime
    const created = await PricingConfig.create({});
    config = created.toObject();
    console.warn('[PricingService] PricingConfig was missing — seeded default.');
  }
  _configCache = config;
  _cacheExpiresAt = now + CONFIG_CACHE_TTL_MS;
  return config;
};

/** Invalidate the in-memory config cache (call after admin updates PricingConfig). */
const invalidateConfigCache = () => {
  _configCache = null;
  _cacheExpiresAt = 0;
};

// ── Referral Validation ───────────────────────────────────────────────────────

/**
 * Validates a referral code. Does NOT apply any credits — pure validation only.
 *
 * @param {string} code - The referral code to validate (format: VIR-XXXXXX)
 * @param {string} currentUserId - MongoDB ObjectId string of the user trying to use the code
 * @returns {Promise<{ valid: boolean, referrer: object|null, message: string }>}
 */
const validateReferralCode = async (code, currentUserId) => {
  if (!code || typeof code !== 'string') {
    return { valid: false, referrer: null, message: 'No referral code provided.' };
  }

  const normalised = code.trim().toUpperCase();

  // Format check
  if (!/^VIR-[A-Z0-9]{6}$/.test(normalised)) {
    return { valid: false, referrer: null, message: 'Invalid referral code format.' };
  }

  const referrer = await User.findOne({ referralCode: normalised }).lean();

  if (!referrer) {
    return { valid: false, referrer: null, message: 'Referral code not found.' };
  }

  // Self-referral check
  if (referrer._id.toString() === currentUserId.toString()) {
    return { valid: false, referrer: null, message: 'You cannot use your own referral code.' };
  }

  return { valid: true, referrer, message: 'Valid referral code.' };
};

// ── Referral Credit Application ───────────────────────────────────────────────

/**
 * Adds a referral credit to the referrer's account.
 * If the referrer has already paid in full, the credit is stored as referralCredit
 * for future adjustment or refund.
 *
 * @param {string} referrerUserId - MongoDB ObjectId string of the referrer
 * @param {number} amount - Credit amount in INR (typically from config.referralBonus)
 * @returns {Promise<void>}
 */
const applyReferralCredit = async (referrerUserId, amount) => {
  try {
    await User.findByIdAndUpdate(
      referrerUserId,
      { $inc: { referralCredit: amount } },
      { new: true }
    );
    console.info(
      JSON.stringify({
        event: 'REFERRAL_CREDIT_APPLIED',
        referrerId: referrerUserId,
        amount,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (err) {
    console.error('[PricingService] Failed to apply referral credit:', err.message);
    throw err;
  }
};

// ── Core Calculation Engine ───────────────────────────────────────────────────

/**
 * Calculates the full payment breakdown for a new payment initiation.
 *
 * FORMULA (authoritative):
 *
 *   discountedMonthlyBase    = Math.round(roomMonthly × (1 - discountRate))
 *   monthlyGST               = Math.round(discountedMonthlyBase × gstRate)
 *   discountedMonthlyWithGST = discountedMonthlyBase + monthlyGST
 *
 *   For 'full' mode:
 *     roomRentTotal = discountedMonthlyWithGST × tenureMonths
 *     transportTotal = Math.round(transportMonthly × (1 - discountRate)) × tenureMonths  [if selected]
 *     messTotal     = Math.round(messLumpSum × (1 - discountRate))                       [if lumpSum]
 *                   OR Math.round(messMonthly × (1 - discountRate)) × tenureMonths        [if monthly]
 *     subtotal      = roomRentTotal + transportTotal + messTotal
 *     finalAmount   = subtotal + flatFees - referralDeduction
 *
 *   For 'half' mode (installment 1 = 6 months, installment 2 = 5 months):
 *     inst1RoomTotal     = discountedMonthlyWithGST × installment1Months
 *     inst2RoomTotal     = discountedMonthlyWithGST × (tenureMonths - installment1Months)
 *     inst1TransportTotal = discountedMonthlyTransport × installment1Months
 *     inst2TransportTotal = discountedMonthlyTransport × (tenureMonths - installment1Months)
 *     inst1MessTotal     = discountedMonthlyMess × installment1Months
 *     inst2MessTotal     = discountedMonthlyMess × (tenureMonths - installment1Months)
 *     installment1 = inst1RoomTotal + inst1Transport + inst1Mess + flatFees - referralDeduction
 *     installment2 = inst2RoomTotal + inst2Transport + inst2Mess   (NO flat fees, NO referral)
 *
 * @param {Object} params
 * @param {string} params.roomTypeId   - MongoDB ObjectId of the RoomType
 * @param {string} params.paymentMode  - 'full' | 'half'
 * @param {Object} params.addOns       - { transport: boolean, mess: boolean, messLumpSum: boolean }
 * @param {string|null} params.referralCode   - Referral code string or null
 * @param {string}      params.currentUserId  - ObjectId string of the paying user
 * @param {number}      [params.depositCredit=0] - Deposit already paid (from depositService.getDepositCredit)
 * @returns {Promise<{
 *   breakdown: Object,
 *   installment1: number,
 *   installment2: number,
 *   referrer: Object|null
 * }>}
 */
const calculatePayment = async ({
  roomTypeId,
  paymentMode,
  addOns = {},
  referralCode = null,
  currentUserId,
  depositCredit = 0, // Amount already paid as deposit (₹15,000 if active hold exists)
}) => {
  // ── 1. Load pricing config ────────────────────────────────────────────────
  const cfg = await getPricingConfig();
  const {
    registrationFee,
    securityDeposit,
    gstRate,
    transportMonthly,
    messMonthly,
    messLumpSum: messLumpSumAmount,
    discountFull,
    discountHalf,
    referralBonus,
    tenureMonths,
    installment1Months,
  } = cfg;

  const installment2Months = tenureMonths - installment1Months; // typically 5

  // ── 2. Load room type ─────────────────────────────────────────────────────
  const roomType = await RoomType.findById(roomTypeId).lean();
  if (!roomType) {
    const err = new Error('Room type not found.');
    err.statusCode = 404;
    throw err;
  }

  // Resolve room monthly price from RoomType document.
  // The DB stores:
  //   basePrice       = monthly rate INCLUSIVE of GST (e.g. 27,483 for Axis Plus Studio)
  //   discountedPrice = after-discount monthly rate (we do NOT use this — we calculate it)
  //   pricing.original / pricing.discounted = nested format (same semantics)
  //
  // We need the PRE-DISCOUNT, PRE-TAX monthly base to apply our own discount formula.
  // Derive it: preDiscountPreTax = basePrice / (1 + gstRate)
  const roomMonthlyAllIn =
    roomType.pricing?.original ??
    roomType.basePrice ??
    0;

  if (!roomMonthlyAllIn || roomMonthlyAllIn <= 0) {
    const err = new Error('Room type has no valid price configured.');
    err.statusCode = 422;
    throw err;
  }

  // Derive pre-GST monthly base (rounded to nearest rupee)
  // Formula: preGST = round(basePrice / (1 + gstRate))
  const roomMonthly = Math.round(roomMonthlyAllIn / (1 + gstRate));

  // ── 3. Resolve payment mode & discount rate ───────────────────────────────
  if (!['full', 'half'].includes(paymentMode)) {
    const err = new Error('paymentMode must be "full" or "half".');
    err.statusCode = 400;
    throw err;
  }

  const discountRate = paymentMode === 'full' ? discountFull : discountHalf;

  // ── 4. Business rule: messLumpSum only valid for full payment mode ─────────
  const { transport = false, mess = false, messLumpSum = false } = addOns;
  if (messLumpSum && paymentMode === 'half') {
    const err = new Error(
      'Mess lump sum discount is only available for full payment mode.'
    );
    err.statusCode = 422;
    throw err;
  }
  if (messLumpSum && !mess) {
    const err = new Error('messLumpSum can only be true when mess add-on is selected.');
    err.statusCode = 422;
    throw err;
  }

  // ── 5. Referral validation ────────────────────────────────────────────────
  let referrer = null;
  let referralDeduction = 0;

  if (referralCode) {
    const refResult = await validateReferralCode(referralCode, currentUserId);
    if (!refResult.valid) {
      const err = new Error(refResult.message);
      err.statusCode = 422;
      throw err;
    }
    referrer = refResult.referrer;
    referralDeduction = referralBonus;
  }

  // ── 6. Room rent per-month calculation (two-step rounding, Indian GST std) ─
  const discountedMonthlyBase    = Math.round(roomMonthly * (1 - discountRate));
  const monthlyGST               = Math.round(discountedMonthlyBase * gstRate);
  const discountedMonthlyWithGST = discountedMonthlyBase + monthlyGST;

  // ── 7. Transport per-month (discounted, no GST) ────────────────────────────
  const discountedMonthlyTransport = transport
    ? Math.round(transportMonthly * (1 - discountRate))
    : 0;

  // ── 8. Mess calculation ───────────────────────────────────────────────────
  const discountedMonthlyMess = mess
    ? Math.round(messMonthly * (1 - discountRate))
    : 0;

  // ── 9. Flat fees (added to installment 1 only, not discounted) ────────────
  const flatFees = registrationFee + securityDeposit;

  // ── 10. Installment split ─────────────────────────────────────────────────
  let installment1, installment2;
  let inst1Breakdown, inst2Breakdown;

  if (paymentMode === 'full') {
    // Mess total for full mode
    let messTotal;
    if (!mess) {
      messTotal = 0;
    } else if (messLumpSum) {
      messTotal = Math.round(messLumpSumAmount * (1 - discountRate));
    } else {
      messTotal = discountedMonthlyMess * tenureMonths;
    }

    const roomRentTotal      = discountedMonthlyWithGST * tenureMonths;
    const transportTotal     = discountedMonthlyTransport * tenureMonths;
    const subtotal           = roomRentTotal + transportTotal + messTotal;
    const depositCreditAmt   = Math.max(0, depositCredit); // ensure non-negative
    const finalAmount        = subtotal + flatFees - referralDeduction - depositCreditAmt;

    installment1 = finalAmount;
    installment2 = 0;

    inst1Breakdown = {
      roomMonthly,
      discountedMonthlyBase,
      monthlyGST,
      discountedMonthlyWithGST,
      roomRentTotal,
      registrationFee,
      securityDeposit,
      transportMonthly: transport ? transportMonthly : 0,
      transportTotal,
      messMonthly:    mess ? messMonthly : 0,
      messTotal,
      messIsLumpSum:  messLumpSum,
      discountRate,
      gstRate,
      tenureMonths,
      installmentMonths: tenureMonths,
      subtotal,
      flatFees,
      referralDeduction,
      depositCredited: depositCreditAmt,
      finalAmount,
    };
    inst2Breakdown = null;

  } else {
    // ── HALF mode ──────────────────────────────────────────────────────────
    // Mess for half mode — always monthly rate, no lump sum (enforced above)
    const inst1MessTotal = discountedMonthlyMess * installment1Months;
    const inst2MessTotal = discountedMonthlyMess * installment2Months;

    const inst1RoomTotal      = discountedMonthlyWithGST * installment1Months;
    const inst2RoomTotal      = discountedMonthlyWithGST * installment2Months;
    const inst1TransportTotal = discountedMonthlyTransport * installment1Months;
    const inst2TransportTotal = discountedMonthlyTransport * installment2Months;

    const inst1Subtotal  = inst1RoomTotal + inst1TransportTotal + inst1MessTotal;
    const inst2Subtotal  = inst2RoomTotal + inst2TransportTotal + inst2MessTotal;

    const depositCreditAmt = Math.max(0, depositCredit);

    installment1 = inst1Subtotal + flatFees - referralDeduction - depositCreditAmt;
    installment2 = inst2Subtotal; // No flat fees, referral, or deposit credit on installment 2

    const totalFinalAmount = installment1 + installment2;

    inst1Breakdown = {
      roomMonthly,
      discountedMonthlyBase,
      monthlyGST,
      discountedMonthlyWithGST,
      roomRentTotal:      inst1RoomTotal,
      registrationFee,
      securityDeposit,
      transportMonthly:   transport ? transportMonthly : 0,
      transportTotal:     inst1TransportTotal,
      messMonthly:        mess ? messMonthly : 0,
      messTotal:          inst1MessTotal,
      messIsLumpSum:      false,
      discountRate,
      gstRate,
      tenureMonths,
      installmentMonths:  installment1Months,
      subtotal:           inst1Subtotal,
      flatFees,
      referralDeduction,
      depositCredited:    depositCreditAmt,
      finalAmount:        installment1,
    };
    inst2Breakdown = {
      roomMonthly,
      discountedMonthlyBase,
      monthlyGST,
      discountedMonthlyWithGST,
      roomRentTotal:      inst2RoomTotal,
      registrationFee:    0,
      securityDeposit:    0,
      transportMonthly:   transport ? transportMonthly : 0,
      transportTotal:     inst2TransportTotal,
      messMonthly:        mess ? messMonthly : 0,
      messTotal:          inst2MessTotal,
      messIsLumpSum:      false,
      discountRate,
      gstRate,
      tenureMonths,
      installmentMonths:  installment2Months,
      subtotal:           inst2Subtotal,
      flatFees:           0,
      referralDeduction:  0,
      finalAmount:        installment2,
    };

    // Audit helper — total across both installments
    inst1Breakdown._totalFinalAmount = totalFinalAmount;
  }

  return {
    breakdown:    inst1Breakdown,
    breakdown2:   inst2Breakdown,
    installment1,
    installment2,
    referrer,
    config: {
      discountRate,
      tenureMonths,
      installment1Months,
      installment2Months,
    },
  };
};

// ── Installment Schedule ──────────────────────────────────────────────────────

/**
 * Returns the installment schedule array for a given payment mode and onboarding date.
 *
 * @param {string} paymentMode - 'full' | 'half'
 * @param {Date}   onboardingDate - Date of the first payment / onboarding
 * @param {number} installment1Amount
 * @param {number} installment2Amount
 * @returns {Array<{ installmentNumber: number, dueDate: Date, amount: number }>}
 */
const getInstallmentSchedule = (
  paymentMode,
  onboardingDate,
  installment1Amount,
  installment2Amount
) => {
  const schedule = [
    {
      installmentNumber: 1,
      dueDate: new Date(onboardingDate),
      amount: installment1Amount,
    },
  ];

  if (paymentMode === 'half' && installment2Amount > 0) {
    // Installment 2 is due at the START of month 6 (5 months after onboarding)
    const inst2Date = new Date(onboardingDate);
    inst2Date.setMonth(inst2Date.getMonth() + 5);
    schedule.push({
      installmentNumber: 2,
      dueDate: inst2Date,
      amount: installment2Amount,
    });
  }

  return schedule;
};

// ── Upcoming Installments ─────────────────────────────────────────────────────

/**
 * Fetches all upcoming (pre-created) installment Payment records for a user.
 * Used by the resident dashboard to show what's due next.
 *
 * @param {string} userId - MongoDB ObjectId string
 * @returns {Promise<Array>}
 */
const getUpcomingInstallments = async (userId) => {
  const Payment = require('../models/Payment');
  return Payment.find({ userId, status: 'upcoming' }).sort({ dueDate: 1 }).lean();
};

module.exports = {
  getPricingConfig,
  invalidateConfigCache,
  calculatePayment,
  validateReferralCode,
  applyReferralCredit,
  getInstallmentSchedule,
  getUpcomingInstallments,
};
