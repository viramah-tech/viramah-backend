'use strict';

/**
 * adjustmentEngine — THE core payment computation.
 * Plan Section 5. Pure. No DB writes. Never cached. Runs every time.
 *
 * Two entry points:
 *   - computePhaseAmount(planId, phaseNumber, userId) — loads from DB, then delegates
 *   - computeBookingAmount(planId) — Track 3 initial booking (no discount)
 *
 * Internal pure helper:
 *   - _compute({ plan, phase, discountRate, discountSource, adjustments })
 *     — takes already-loaded data, returns computed breakdown. Tests call this directly.
 *
 * Discount is ALWAYS rent-only. Never applied to security, registration, lunch, or transport.
 */

const PaymentPlan    = require('../models/PaymentPlan');
const Adjustment     = require('../models/Adjustment');
const DiscountConfig = require('../models/DiscountConfig');

/**
 * Pure computation — no DB access.
 * @param {Object} args
 * @param {Object} args.plan                 — PaymentPlan-shaped object
 * @param {Object} args.phase                — phase sub-document
 * @param {number} args.discountRate         — effective rate (0..1)
 * @param {string} args.discountSource       — 'global' | 'per_user_override'
 * @param {Array}  [args.adjustments=[]]     — approved monetary adjustments for this phase
 * @returns {Object} computed breakdown
 */
function _compute({ plan, phase, discountRate, discountSource, adjustments = [] }) {
  const monthlyRent = plan.components.monthlyRent || 0;
  const months      = phase.monthsCovered || 0;

  // Step 1 — discountable base
  const grossRent = monthlyRent * months;

  // Step 2 — apply discount (rent only)
  const discountAmount = grossRent * discountRate;
  const netRent        = grossRent - discountAmount;

  // Step 3 — non-rental components at full value, skip already-collected
  const alreadyCollected = phase.componentsAlreadyCollected || [];
  let nonRentalTotal = 0;
  const nonRentalLines = [];

  if (!alreadyCollected.includes('security') && plan.components.securityDeposit) {
    nonRentalTotal += plan.components.securityDeposit;
    nonRentalLines.push({ label: 'Security deposit', amount: plan.components.securityDeposit, type: 'charge' });
  }
  if (!alreadyCollected.includes('registration') && plan.components.registrationCharges) {
    nonRentalTotal += plan.components.registrationCharges;
    nonRentalLines.push({ label: 'Registration charges', amount: plan.components.registrationCharges, type: 'charge' });
  }
  if (plan.components.lunch?.opted && !alreadyCollected.includes('lunch')) {
    const v = plan.components.lunch.total || 0;
    nonRentalTotal += v;
    nonRentalLines.push({ label: `Lunch (${plan.components.lunch.totalMonths} months)`, amount: v, type: 'charge' });
  }
  if (plan.components.transport?.opted && !alreadyCollected.includes('transport')) {
    const v = plan.components.transport.total || 0;
    nonRentalTotal += v;
    nonRentalLines.push({ label: `Transport (${plan.components.transport.totalMonths} months)`, amount: v, type: 'charge' });
  }

  // Step 4 — monetary adjustments (waivers / custom charges / credits / penalties)
  let adjustmentTotal = 0;
  const adjustmentBreakdown = [];
  for (const adj of adjustments) {
    const base = adj.valueType === 'percentage' ? netRent * (adj.value || 0) : (adj.value || 0);
    const sign = ['waiver', 'credit'].includes(adj.type) ? -1 : 1;
    const signed = sign * base;
    adjustmentTotal += signed;
    adjustmentBreakdown.push({
      label:  adj.description || adj.type,
      amount: signed,
      type:   signed < 0 ? 'credit' : 'charge',
    });
  }

  // Step 5 — advance credit carry-forward
  const advanceAvailable = Math.max(0, plan.advanceCreditRemaining || 0);
  const preCreditTotal   = netRent + nonRentalTotal + adjustmentTotal;
  const advanceCreditApplied = Math.min(advanceAvailable, Math.max(0, preCreditTotal));

  // Step 6 — final amount (full phase total), and amount still due after
  // subtracting any partial payments already approved against this phase.
  const finalAmount = preCreditTotal - advanceCreditApplied;
  const alreadyPaid = Math.max(0, phase.amountPaid || 0);
  const amountDue   = Math.max(0, finalAmount - alreadyPaid);

  // Step 7 — breakdown for UI
  const breakdown = [
    { label: `Rent (${months} months)`, amount: grossRent, type: 'charge' },
  ];
  if (discountAmount > 0) {
    breakdown.push({
      label:  `Discount (${(discountRate * 100).toFixed(0)}% on rent)`,
      amount: -discountAmount,
      type:   'discount',
    });
  }
  breakdown.push(...nonRentalLines);
  breakdown.push(...adjustmentBreakdown);
  if (advanceCreditApplied > 0) {
    breakdown.push({ label: 'Advance credit applied', amount: -advanceCreditApplied, type: 'credit' });
  }
  breakdown.push({ label: 'Total payable', amount: finalAmount, type: 'total' });

  return {
    grossRent,
    discountRate,
    discountSource,
    discountAmount,
    netRent,
    nonRentalTotal,
    adjustmentTotal,
    advanceCreditApplied,
    finalAmount,
    amountPaid: alreadyPaid,
    amountDue,
    breakdown,
  };
}

/**
 * Resolves effective discount rate + source for a given plan + user.
 * Shared by persisted and in-memory (preview) phase computation.
 */
async function _resolveDiscount(plan, userId) {
  const override = await Adjustment.findOne({
    userId,
    type: 'discount_override',
    status: 'approved',
  }).sort({ createdAt: -1 });

  const trackForDiscount = plan.chosenTrackId || plan.trackId;
  const global = trackForDiscount === 'booking'
    ? null
    : await DiscountConfig.findOne({ trackId: trackForDiscount });

  let discountRate   = 0;
  let discountSource = 'global';
  if (override) {
    discountRate   = override.newDiscountRate || 0;
    discountSource = 'per_user_override';
  } else if (global?.isActive) {
    discountRate   = global.defaultDiscountRate || 0;
  }
  return { discountRate, discountSource };
}

/**
 * Pure entry point — computes a phase amount from an in-memory plan object.
 * Used for PREVIEW before the plan has been persisted (first-payment flow).
 * No plan-linked adjustments are loaded because there is no planId yet;
 * only per-user discount overrides apply.
 */
async function computePhaseAmountFromPlan(plan, phaseNumber, userId) {
  const phase = (plan.phases || []).find((p) => p.phaseNumber === phaseNumber);
  if (!phase) {
    const err = new Error(`Phase ${phaseNumber} not found on in-memory plan`);
    err.statusCode = 404;
    throw err;
  }
  const { discountRate, discountSource } = await _resolveDiscount(plan, userId);
  return _compute({ plan, phase, discountRate, discountSource, adjustments: [] });
}

/**
 * DB-loading entry point. Loads plan, effective discount, and adjustments,
 * then calls _compute.
 */
async function computePhaseAmount(planId, phaseNumber, userId) {
  const plan = await PaymentPlan.findById(planId);
  if (!plan) {
    const err = new Error('Payment plan not found');
    err.statusCode = 404;
    throw err;
  }
  const phase = plan.phases.find((p) => p.phaseNumber === phaseNumber);
  if (!phase) {
    const err = new Error(`Phase ${phaseNumber} not found on plan ${planId}`);
    err.statusCode = 404;
    throw err;
  }

  const { discountRate, discountSource } = await _resolveDiscount(plan, userId);

  // Approved monetary adjustments for this phase
  const adjustments = await Adjustment.find({
    userId,
    planId,
    phaseNumber: { $in: [phaseNumber, 'all'] },
    type: { $in: ['waiver', 'custom_charge', 'credit', 'penalty'] },
    status: 'approved',
  });

  return _compute({
    plan: plan.toObject ? plan.toObject() : plan,
    phase,
    discountRate,
    discountSource,
    adjustments,
  });
}

/**
 * Pure entry point — Track 3 booking amount from an in-memory plan object.
 */
function computeBookingAmountFromPlan(plan) {
  const security     = plan.components.securityDeposit     || 0;
  const registration = plan.components.registrationCharges || 0;
  const advance      = plan.advanceCreditTotal              || 0;
  const finalAmount  = security + registration + advance;

  const breakdown = [
    { label: 'Security deposit',     amount: security,     type: 'charge' },
    { label: 'Registration charges', amount: registration, type: 'charge' },
  ];
  if (advance > 0) {
    breakdown.push({ label: 'Advance payment (credit)', amount: advance, type: 'charge' });
  }
  breakdown.push({ label: 'Total payable', amount: finalAmount, type: 'total' });

  return {
    grossRent: 0,
    discountRate: 0,
    discountSource: 'global',
    discountAmount: 0,
    netRent: 0,
    nonRentalTotal: security + registration,
    adjustmentTotal: 0,
    advanceCreditApplied: 0,
    advancePrepaid: advance,
    finalAmount,
    breakdown,
  };
}

/**
 * Track 3 initial booking amount — security + registration + optional advance.
 * Never discounted.
 */
async function computeBookingAmount(planId) {
  const plan = await PaymentPlan.findById(planId);
  if (!plan) {
    const err = new Error('Payment plan not found');
    err.statusCode = 404;
    throw err;
  }
  const security     = plan.components.securityDeposit     || 0;
  const registration = plan.components.registrationCharges || 0;
  const advance      = plan.advanceCreditTotal              || 0;
  const finalAmount  = security + registration + advance;

  const breakdown = [
    { label: 'Security deposit',     amount: security,     type: 'charge' },
    { label: 'Registration charges', amount: registration, type: 'charge' },
  ];
  if (advance > 0) {
    breakdown.push({ label: 'Advance payment (credit)', amount: advance, type: 'charge' });
  }
  breakdown.push({ label: 'Total payable', amount: finalAmount, type: 'total' });

  return {
    grossRent: 0,
    discountRate: 0,
    discountSource: 'global',
    discountAmount: 0,
    netRent: 0,
    nonRentalTotal: security + registration,
    adjustmentTotal: 0,
    advanceCreditApplied: 0,
    advancePrepaid: advance,
    finalAmount,
    breakdown,
  };
}

/**
 * Compute the booking credit to apply against final payment.
 * The ₹16,180 booking amount is credited as follows:
 *   - ₹15,000 security deposit → NOT deducted from rent (refundable post-tenancy)
 *   - ₹1,000 registration fee → deducted from Phase 1
 *   - ₹180 registration GST → deducted from Phase 1
 * Net credit against rent: ₹1,180 (registration + GST)
 * Security deposit stays as refundable balance.
 */
function computeBookingCredit(booking) {
  if (!booking || !booking.financials) return 0;
  
  const registrationFee = booking.financials.registrationFee || 100000;
  const registrationGst = booking.financials.registrationGst || 18000;
  
  // Return paise
  return registrationFee + registrationGst; // ₹1,180 default
}

module.exports = {
  computePhaseAmount,
  computeBookingAmount,
  computePhaseAmountFromPlan,
  computeBookingAmountFromPlan,
  computeBookingCredit,
  _compute, // exported for unit tests
};
