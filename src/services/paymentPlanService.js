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
  const baseMonthly = roomType.monthlyRent || roomType.price || 0;
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

  // Reject if user already has an active plan with submitted payments
  // If no payments exist, cancel the old plan to allow re-selection
  const existing = await PaymentPlan.findOne({ userId, status: 'active' });
  if (existing) {
    const paymentExists = await Payment.findOne({ planId: existing._id, status: { $in: ['pending', 'approved'] } });
    if (paymentExists) {
      throw err('An active payment plan with submitted payments already exists for this user', 409);
    } else {
      existing.status = 'cancelled';
      existing.cancelledReason = 'User replaced the track before making any payment';
      await existing.save();
    }
  }

  const components = await buildComponents(user, { addOns });
  const phases     = buildPhasesFor(trackId, components);

  const hold = await RoomHold.findOne({ userId }).sort({ createdAt: -1 });

  const plan = await PaymentPlan.create({
    userId,
    bookingId: hold?._id || null,
    roomId:    user.roomTypeId,
    trackId,
    chosenTrackId: trackId,
    components,
    phases,
    createdBy: { userId, role: 'resident' },
  });

  return plan;
}

/**
 * POST /api/payment/plan/booking — Track 3 initial booking.
 */
async function createBookingPlan(userId, { addOns = {}, advance = 0 } = {}) {
  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);

  // Reject if user already has an active plan with submitted payments
  // If no payments exist, cancel the old plan to allow re-selection
  const existing = await PaymentPlan.findOne({ userId, status: 'active' });
  if (existing) {
    const paymentExists = await Payment.findOne({ planId: existing._id, status: { $in: ['pending', 'approved'] } });
    if (paymentExists) {
      throw err('An active payment plan with submitted payments already exists for this user', 409);
    } else {
      existing.status = 'cancelled';
      existing.cancelledReason = 'User replaced the track before making any payment';
      await existing.save();
    }
  }

  const components = await buildComponents(user, { addOns });
  const hold = await RoomHold.findOne({ userId }).sort({ createdAt: -1 });

  const plan = await PaymentPlan.create({
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
    createdBy: { userId, role: 'resident' },
  });

  return plan;
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

  const alreadyCollected = ['security', 'registration'];
  const phases = buildPhasesFor(trackId, plan.components, { alreadyCollected });

  plan.chosenTrackId = trackId;
  plan.phases        = phases;
  // trackId stays as 'booking' historically? No — plan says once upgraded the plan becomes trackId+chosenTrackId.
  // We keep trackId='booking' to remember origin and use chosenTrackId for the engine.
  await plan.save();
  return plan;
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
  getMyPlan,
  getPhaseBreakdown,
};
