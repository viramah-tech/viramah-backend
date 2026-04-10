'use strict';

/**
 * paymentPlanService — V2 payment plan lifecycle.
 * Plan Section 4.1 / 4.2.
 *
 * Responsibilities:
 *   - Build payment_plan documents for each track.
 *   - Read the user's active plan and deliver a fresh (engine-computed) breakdown.
 *   - Handle Track 3 → Track 1/2 upgrade with already-collected components + advance credit.
 *
 * Never reads discount rates directly — always delegates to adjustmentEngine.
 */

const PaymentPlan    = require('../models/PaymentPlan');
const DiscountConfig = require('../models/DiscountConfig');
const User           = require('../models/User');
const RoomType       = require('../models/RoomType');
const RoomHold       = require('../models/RoomHold');
const Payment        = require('../models/Payment');
const Booking        = require('../models/Booking');
const pricingService = require('./pricingService');
const engine         = require('./adjustmentEngine');

// ── Helpers ───────────────────────────────────────────────────────────────────

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * Build the `components` sub-document from live pricing config + user selections.
 * Monthly rent is GST-inclusive (decision: GST folded in, see Phase A resolution).
 */
async function buildComponents(user, { addOns = {} } = {}) {
  if (!user.roomTypeId) throw err('User has no room type assigned', 422);
  const roomType = await RoomType.findById(user.roomTypeId);
  if (!roomType) throw err('Room type not found', 404);

  const cfg = await pricingService.getPricingConfig();
  if (!cfg) throw err('Pricing configuration missing', 503);

  const totalMonths = cfg.tenureMonths || 11;

  // Monthly rent with GST baked in
  const gstRate = cfg.gstRate ?? 0.12;
  // RoomType stores pricing in nested (pricing.discounted / pricing.original)
  // or flat (discountedPrice / basePrice) fields — pick the best available.
  const baseMonthly =
    roomType.pricing?.discounted ||
    roomType.discountedPrice ||
    roomType.pricing?.original ||
    roomType.basePrice ||
    0;
  const monthlyRent = Math.round(baseMonthly * (1 + gstRate));

  const lunchOpted     = !!addOns.mess;
  const transportOpted = !!addOns.transport;

  return {
    monthlyRent,
    totalMonths,
    securityDeposit:     cfg.securityDeposit || 0,
    registrationCharges: cfg.registrationFee || 0,
    lunch: {
      opted: lunchOpted,
      monthlyRate: lunchOpted ? (cfg.messMonthly || 0) : 0,
      totalMonths,
      total: lunchOpted ? ((cfg.messMonthly || 0) * totalMonths) : 0,
    },
    transport: {
      opted: transportOpted,
      monthlyRate: transportOpted ? (cfg.transportMonthly || 0) : 0,
      totalMonths,
      total: transportOpted ? ((cfg.transportMonthly || 0) * totalMonths) : 0,
    },
  };
}

function buildPhasesFor(trackId, components, opts = {}) {
  const { totalMonths } = components;
  const { alreadyCollected = [], phase2DueDate = null } = opts;

  if (trackId === 'full') {
    return [{
      phaseNumber: 1,
      monthsCovered: totalMonths,
      componentsDue: ['rent', 'security', 'registration',
        ...(components.lunch.opted ? ['lunch'] : []),
        ...(components.transport.opted ? ['transport'] : [])],
      componentsAlreadyCollected: alreadyCollected,
      status: 'pending',
      dueDate: new Date(),
    }];
  }
  if (trackId === 'twopart') {
    return [
      {
        phaseNumber: 1,
        monthsCovered: 6,
        componentsDue: ['rent', 'security', 'registration',
          ...(components.lunch.opted ? ['lunch'] : []),
          ...(components.transport.opted ? ['transport'] : [])],
        componentsAlreadyCollected: alreadyCollected,
        status: 'pending',
        dueDate: new Date(),
      },
      {
        phaseNumber: 2,
        monthsCovered: 5,
        componentsDue: ['rent'],
        componentsAlreadyCollected: ['security', 'registration', 'lunch', 'transport'],
        status: 'locked',
        dueDate: phase2DueDate,
        lockedReason: phase2DueDate ? null : 'Awaiting Phase 2 due date',
      },
    ];
  }
  if (trackId === 'booking') {
    // Track 3 initial booking — no phase structure until user upgrades
    return [];
  }
  throw err(`Unknown trackId: ${trackId}`, 400);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * GET /api/payment/config — discount rates + track rules for display.
 */
async function getConfig() {
  const [full, twopart] = await Promise.all([
    DiscountConfig.findOne({ trackId: 'full' }),
    DiscountConfig.findOne({ trackId: 'twopart' }),
  ]);
  return {
    tracks: {
      full: {
        id: 'full',
        name: 'Full Payment',
        phases: 1,
        discountRate:    full?.isActive ? full.defaultDiscountRate : 0,
        discountApplies: 'rent_only',
      },
      twopart: {
        id: 'twopart',
        name: 'Two-Part Payment',
        phases: 2,
        discountRate:    twopart?.isActive ? twopart.defaultDiscountRate : 0,
        discountApplies: 'rent_only',
      },
      booking: {
        id: 'booking',
        name: 'Booking First',
        phases: 0,
        discountRate:    0,
        discountApplies: null,
      },
    },
  };
}

/**
 * POST /api/payment/plan/select-track — Track 1 or Track 2.
 *
 * PREVIEW ONLY. No PaymentPlan is persisted here. The plan is materialised
 * atomically with the first Payment by paymentSubmitService.submitPayment.
 * The client must re-send `{ trackId, addOns }` inside `trackSelection`
 * when posting the first payment.
 */
async function selectTrack(userId, { trackId, addOns = {} }) {
  if (!['full', 'twopart'].includes(trackId)) {
    throw err('trackId must be "full" or "twopart"', 400);
  }
  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);
  if (user.onboardingStatus !== 'completed') {
    throw err('Complete onboarding before selecting a track', 422);
  }

  // If an active (already-persisted) plan exists, the user is past first payment.
  const existing = await PaymentPlan.findOne({ userId, status: 'active' });
  if (existing) {
    throw err('An active payment plan already exists for this user', 409);
  }

  const components = await buildComponents(user, { addOns });
  const phases     = buildPhasesFor(trackId, components);

  const hold = await RoomHold.findOne({ userId }).sort({ createdAt: -1 });

  const previewPlan = {
    userId,
    bookingId: hold?._id || null,
    roomId:    user.roomTypeId,
    trackId,
    chosenTrackId: trackId,
    components,
    phases,
    advanceCreditTotal:     0,
    advanceCreditConsumed:  0,
    advanceCreditRemaining: 0,
  };

  const phasesWithBreakdown = [];
  for (const phase of phases) {
    if (phase.status === 'locked' && !phase.dueDate) {
      phasesWithBreakdown.push({ ...phase, computed: null });
      continue;
    }
    const computed = await engine.computePhaseAmountFromPlan(previewPlan, phase.phaseNumber, userId);
    phasesWithBreakdown.push({ ...phase, computed });
  }

  return {
    preview: true,
    ...previewPlan,
    phases: phasesWithBreakdown,
    trackSelection: { trackId, addOns }, // echo back for client to re-send on submit
  };
}

/**
 * POST /api/payment/plan/booking — Track 3 initial booking.
 *
 * PREVIEW ONLY. No PaymentPlan is persisted here. See selectTrack note.
 * The client must re-send `{ trackId: 'booking', addOns, advance }` inside
 * `trackSelection` when posting the first booking payment.
 */
async function createBookingPlan(userId, { addOns = {}, advance = 0 } = {}) {
  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);

  const existing = await PaymentPlan.findOne({ userId, status: 'active' });
  if (existing) {
    throw err('An active payment plan already exists for this user', 409);
  }

  const components = await buildComponents(user, { addOns });
  const hold = await RoomHold.findOne({ userId }).sort({ createdAt: -1 });

  const previewPlan = {
    userId,
    bookingId: hold?._id || null,
    roomId: user.roomTypeId,
    trackId: 'booking',
    chosenTrackId: null,
    components,
    advanceCreditTotal:     advance,
    advanceCreditConsumed:  0,
    advanceCreditRemaining: advance,
    phases: [],
  };

  const bookingAmount = engine.computeBookingAmountFromPlan(previewPlan);

  return {
    preview: true,
    ...previewPlan,
    bookingAmount,
    trackSelection: { trackId: 'booking', addOns, advance },
  };
}

/**
 * POST /api/payment/plan/upgrade-track — Track 3 → Track 1 or 2.
 * Marks security + registration (+ lunch/transport if paid) as already collected.
 */
async function upgradeTrack(userId, { trackId }) {
  if (!['full', 'twopart'].includes(trackId)) {
    throw err('trackId must be "full" or "twopart"', 400);
  }
  const plan = await PaymentPlan.findOne({ userId, status: 'active', trackId: 'booking' });
  if (!plan) throw err('No active booking plan to upgrade', 404);

  // ── Deadline enforcement ──────────────────────────────────────────────────
  const cfg = await pricingService.getPricingConfig();
  const deadlineDays = cfg.bookingUpgradeDeadlineDays || 30;
  const deadline = new Date(plan.createdAt);
  deadline.setDate(deadline.getDate() + deadlineDays);
  if (Date.now() > deadline.getTime()) {
    throw err(`Booking upgrade deadline (${deadline.toISOString()}) has passed`, 409);
  }

  const alreadyCollected = ['security', 'registration'];
  const phases = buildPhasesFor(trackId, plan.components, { alreadyCollected });

  plan.chosenTrackId = trackId;
  plan.phases        = phases;

  // Snapshot finalAmount onto each new phase so the partial-payment approval
  // logic has a reliable phase total to compare against.
  const planObj = plan.toObject();
  planObj.chosenTrackId = trackId;
  planObj.phases = phases;
  for (const ph of plan.phases) {
    if (ph.status === 'locked' && !ph.dueDate) continue;
    try {
      const c = await engine.computePhaseAmountFromPlan(planObj, ph.phaseNumber, userId);
      ph.finalAmount = c.finalAmount;
    } catch (_) {
      ph.finalAmount = 0;
    }
  }

  await plan.save();
  return plan;
}

/**
 * NEW (V3): Post-booking track selection.
 * Only callable when Booking.status === 'BOOKING_CONFIRMED'.
 * Creates PaymentPlan (backward compat) AND populates Booking.paymentPlan + Booking.installments.
 */
async function selectTrackPostBooking(userId, bookingId, { trackId, addOns = {} }) {
  if (!['full', 'twopart'].includes(trackId)) {
    throw err('trackId must be "full" or "twopart"', 400);
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);
  if (String(booking.userId) !== String(userId)) throw err('Forbidden', 403);
  if (booking.status !== 'BOOKING_CONFIRMED') {
    throw err(`Track selection requires BOOKING_CONFIRMED, current status: ${booking.status}`, 409);
  }

  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);

  // Apply booking credit here. 
  // Registration and GST are credited to Phase 1.
  const creditToApply = engine.computeBookingCredit(booking);

  const components = await buildComponents(user, { addOns });
  // Skip already collected security deposit completely from phases
  const alreadyCollected = ['security'];
  const phases = buildPhasesFor(trackId, components, { alreadyCollected });

  const previewPlan = {
    userId,
    bookingId: booking._id,
    roomId: user.roomTypeId,
    trackId,
    chosenTrackId: trackId,
    components,
    phases,
    advanceCreditTotal: creditToApply,
    advanceCreditConsumed: 0,
    advanceCreditRemaining: creditToApply, // Use advance credit system for the 1180 registration fee
  };

  // Create the parallel plan
  const plan = await PaymentPlan.create({
    ...previewPlan,
    createdBy: { userId, role: 'resident' },
  });

  // Calculate snapshot amounts
  for (const ph of plan.phases) {
    if (ph.status === 'locked' && !ph.dueDate) continue;
    try {
      const c = await engine.computePhaseAmountFromPlan(plan, ph.phaseNumber, userId);
      ph.finalAmount = c.finalAmount;
    } catch (_) {
      ph.finalAmount = 0;
    }
  }
  await plan.save();

  // Populate Booking model installments
  booking.paymentPlan = {
    type: trackId === 'full' ? 'FULL_TENURE' : 'HALF_YEARLY',
    selectedAt: new Date()
  };

  booking.installments = phases.map(p => ({
    installmentNumber: p.phaseNumber,
    period: { startMonth: 1, endMonth: p.monthsCovered }, 
    totalAmount: p.finalAmount,
    paidAmount: 0,
    remainingAmount: p.finalAmount,
    dueDate: p.dueDate,
    status: p.status === 'locked' ? 'PENDING' : 'PENDING'
  }));
  
  booking.status = 'FINAL_PAYMENT_PENDING';
  await booking.save();

  await User.findByIdAndUpdate(userId, { 
    'paymentProfile.paymentStatus': 'FINAL_PAYMENT_PENDING' 
  });

  return { plan, booking };
}

/**
 * GET /api/payment/plan/me — current user's active plan with fresh breakdown per phase.
 */
async function getMyPlan(userId) {
  const plan = await PaymentPlan.findOne({ userId, status: 'active' });
  if (!plan) return null;

  const phasesWithBreakdown = [];
  for (const phase of plan.phases) {
    if (phase.status === 'locked' && !phase.dueDate) {
      phasesWithBreakdown.push({ ...phase.toObject(), computed: null });
      continue;
    }
    const computed = await engine.computePhaseAmount(plan._id, phase.phaseNumber, userId);
    phasesWithBreakdown.push({ ...phase.toObject(), computed });
  }

  const planObj = plan.toObject();
  planObj.phases = phasesWithBreakdown;

  // Also include booking amount if this is a Track 3 plan awaiting upgrade
  if (plan.trackId === 'booking' && !plan.chosenTrackId) {
    planObj.bookingAmount = await engine.computeBookingAmount(plan._id);
  }

  return planObj;
}

/**
 * GET /api/payment/plan/:planId/breakdown?phase=N
 */
async function getPhaseBreakdown(userId, planId, phaseNumber) {
  const plan = await PaymentPlan.findById(planId);
  if (!plan) throw err('Plan not found', 404);
  if (String(plan.userId) !== String(userId)) throw err('Forbidden', 403);
  return engine.computePhaseAmount(plan._id, Number(phaseNumber), userId);
}

module.exports = {
  getConfig,
  selectTrack,
  createBookingPlan,
  upgradeTrack,
  selectTrackPostBooking,
  getMyPlan,
  getPhaseBreakdown,
  // Internal helpers exposed for atomic plan-on-first-payment creation
  buildComponents,
  buildPhasesFor,
};
