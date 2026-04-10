'use strict';

/**
 * paymentSubmitService — V2 resident-facing payment submission.
 * Plan Section 4.2 + Section 2.4 (mandatory proof of payment).
 *
 * Creates a Payment doc with status='pending'. Approval lives in
 * paymentReviewService (Phase D-4) and is responsible for ledger posting.
 */

const Payment     = require('../models/Payment');
const PaymentPlan = require('../models/PaymentPlan');
const User        = require('../models/User');
const RoomHold    = require('../models/RoomHold');
const Booking     = require('../models/Booking');
const engine      = require('./adjustmentEngine');
const planService = require('./paymentPlanService');
const { processOcr, checkDuplicateUtr } = require('./paymentVerificationService');
const { emitToAdmins, emitToUser } = require('./socketService');
const { v4: uuidv4 } = require('uuid');

const PAYMENT_METHODS = ['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'OTHER'];

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * Map plan track + phase → paymentType enum.
 */
function paymentTypeFor(plan, phaseNumber) {
  if (plan.trackId === 'booking' && !plan.chosenTrackId) return 'track3_booking';
  const t = plan.chosenTrackId || plan.trackId;
  if (t === 'full')    return 'track1_full';
  if (t === 'twopart') return phaseNumber === 2 ? 'track2_phase2' : 'track2_phase1';
  return 'manual_admin';
}

/**
 * POST /api/payment/submit
 *
 * Validates the three mandatory proof fields, recomputes the phase amount fresh
 * from the engine (frontend amount is IGNORED), creates a pending Payment, emits
 * the payment:submitted socket event.
 */
async function submitPayment(userId, body) {
  const { planId, phaseNumber, transactionId, receiptUrl, paymentMethod, trackSelection, amount: clientAmount } = body;

  // ── Mandatory proof fields — Section 2.4 ────────────────────────────────────
  if (!transactionId || !String(transactionId).trim()) {
    throw err('transactionId is required', 400);
  }
  if (!receiptUrl || !String(receiptUrl).trim()) {
    throw err('receiptUrl is required', 400);
  }
  if (!paymentMethod || !PAYMENT_METHODS.includes(paymentMethod)) {
    throw err(`paymentMethod is required and must be one of: ${PAYMENT_METHODS.join(', ')}`, 400);
  }

  // ── FIRST-TIME PATH: no planId yet — create plan atomically with payment ────
  if (!planId) {
    if (!trackSelection || !trackSelection.trackId) {
      throw err('planId or trackSelection.trackId is required', 400);
    }
    return _submitFirstPayment(userId, {
      trackSelection,
      transactionId, receiptUrl, paymentMethod,
      clientAmount,
    });
  }

  const plan = await PaymentPlan.findById(planId);
  if (!plan) throw err('Payment plan not found', 404);
  if (String(plan.userId) !== String(userId)) throw err('Forbidden', 403);
  if (plan.status !== 'active') throw err('Payment plan is not active', 409);

  // ── Booking-only submission (Track 3 initial) ───────────────────────────────
  const isBooking = plan.trackId === 'booking' && !plan.chosenTrackId;
  let computed;
  let phase = null;
  if (isBooking) {
    if (phaseNumber != null) throw err('Booking submission must not include phaseNumber', 400);
    computed = await engine.computeBookingAmount(plan._id);
  } else {
    if (![1, 2].includes(Number(phaseNumber))) {
      throw err('phaseNumber must be 1 or 2', 400);
    }
    phase = plan.phases.find((p) => p.phaseNumber === Number(phaseNumber));
    if (!phase) throw err(`Phase ${phaseNumber} not found on plan`, 404);
    if (phase.status === 'paid')   throw err('Phase already paid', 409);
    if (phase.status === 'locked') throw err('Phase is locked', 409);

    // ── Deadline enforcement for Phase 1 ──────────────────────────────────────
    if (Number(phaseNumber) === 1) {
      const cfg = await (require('./pricingService').getPricingConfig());
      const deadlineDays = cfg.phase1DeadlineDays || 15;
      const anchor = phase.dueDate ? new Date(phase.dueDate) : new Date(plan.createdAt);
      const deadline = new Date(anchor);
      deadline.setDate(deadline.getDate() + deadlineDays);
      if (Date.now() > deadline.getTime()) {
        throw err(`Phase 1 deadline (${deadline.toISOString()}) has passed`, 409);
      }
    }

    // ── Enforce Booking Confirmed (V3 Core Flow Inversion) ─────────────────
    if (plan.bookingId) {
      const booking = await Booking.findById(plan.bookingId);
      if (booking && booking.status !== 'BOOKING_CONFIRMED' && booking.status !== 'FINAL_PAYMENT_PENDING' && booking.status !== 'PARTIALLY_PAID') {
         throw err(`Cannot submit phase payment unless booking is confirmed (Current status: ${booking.status})`, 409);
      }
    }

    computed = await engine.computePhaseAmount(plan._id, Number(phaseNumber), userId);
  }

  // ── Dedup transactionId & generate UTR hash ──────────────────────────────
  const dupCheck = await checkDuplicateUtr(transactionId, (clientAmount || computed?.finalAmount), new Date().toISOString());
  if (dupCheck.isDuplicate) {
    throw err('A payment with this transaction ID already exists', 409);
  }

  // ── Partial-payment: compute how much the user is submitting now ───────────
  // Sum pending+approved payments already attached to this phase and make sure
  // this new submission does not exceed the phase total.
  let submitAmount;
  let amountDue;
  if (isBooking) {
    // Booking is an atomic flat amount — no partial support.
    submitAmount = computed.finalAmount;
    amountDue    = computed.finalAmount;
  } else {
    const phaseTotal = computed.finalAmount;
    const priorPayments = await Payment.find({
      userId,
      planId: plan._id,
      phaseNumber: Number(phaseNumber),
      status: { $in: ['pending', 'approved'] },
    }).lean();
    const priorSum = priorPayments.reduce((s, p) => s + (p.amount || 0), 0);
    amountDue = Math.max(0, phaseTotal - priorSum);

    if (amountDue <= 0) {
      throw err('Phase has no remaining balance', 409);
    }

    // If client supplies an explicit amount, treat as partial; otherwise pay all remaining.
    if (clientAmount != null) {
      const n = Number(clientAmount);
      if (!Number.isFinite(n) || n <= 0) {
        throw err('amount must be a positive number', 400);
      }
      if (n > amountDue) {
        throw err(`amount exceeds remaining phase balance (₹${amountDue})`, 422);
      }
      submitAmount = Math.round(n);
    } else {
      submitAmount = amountDue;
    }
  }

  const isPartial = !isBooking && submitAmount < computed.finalAmount;

  // ── Create Payment ─────────────────────────────────────────────────────────
  const payment = await Payment.create({
    userId,
    planId:    plan._id,
    bookingId: plan.bookingId || null,
    phaseNumber: isBooking ? null : Number(phaseNumber),
    paymentType: paymentTypeFor(plan, Number(phaseNumber)),
    amount:               submitAmount,
    grossRent:            computed.grossRent || 0,
    discountAmount:       computed.discountAmount || 0,
    netRent:              computed.netRent || 0,
    nonRentalTotal:       computed.nonRentalTotal || 0,
    advanceCreditApplied: computed.advanceCreditApplied || 0,
    transactionId:    String(transactionId).trim(),
    receiptUrl:       String(receiptUrl).trim(),
    paymentMethod:    paymentMethod,
    paymentMethodV2:  paymentMethod,
    status: 'pending',
    submittedAt: new Date(),
    isPartial,
    duplicateCheck: dupCheck,
    idempotencyKey: body.idempotencyKey || uuidv4(),
    proofDocument: {
      fileUrl: String(receiptUrl).trim(),
      uploadedAt: new Date(),
      verificationStatus: 'PENDING'
    }
  });

  // Async OCR Trigger
  processOcr(payment._id, String(receiptUrl).trim()).catch(e => console.error('[OCR Error]', e));

  // ── Emit socket events (Section 7) ─────────────────────────────────────────
  const payload = {
    paymentId:  payment._id,
    planId:     plan._id,
    phaseNumber: payment.phaseNumber,
    amount:     payment.amount,
    userId,
  };
  emitToAdmins('payment:submitted', payload);
  emitToUser(String(userId), 'payment:submitted', payload);

  return { payment, breakdown: computed };
}

/**
 * GET /api/payment/history
 */
async function getHistory(userId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [payments, total] = await Promise.all([
    Payment.find({ userId })
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Payment.countDocuments({ userId }),
  ]);
  return { payments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * GET /api/payment/:paymentId
 */
async function getPaymentById(userId, paymentId) {
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) throw err('Payment not found', 404);
  if (String(payment.userId) !== String(userId)) throw err('Forbidden', 403);
  return payment;
}

/**
 * First-time payment submission: builds the plan in-memory, validates, then
 * atomically creates BOTH the PaymentPlan and the first Payment. If Payment
 * creation fails after the plan is persisted, the orphan plan is rolled back.
 */
async function _submitFirstPayment(userId, { trackSelection, transactionId, receiptUrl, paymentMethod, clientAmount }) {
  const { trackId, addOns = {}, advance = 0 } = trackSelection;
  if (!['full', 'twopart', 'booking'].includes(trackId)) {
    throw err('trackSelection.trackId must be "full", "twopart", or "booking"', 400);
  }

  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);
  if (trackId !== 'booking' && user.onboardingStatus !== 'completed') {
    throw err('Complete onboarding before selecting a track', 422);
  }

  const existing = await PaymentPlan.findOne({ userId, status: 'active' });
  if (existing) throw err('An active payment plan already exists for this user', 409);

  const components = await planService.buildComponents(user, { addOns });
  const isBooking  = trackId === 'booking';
  const phases     = isBooking ? [] : planService.buildPhasesFor(trackId, components);
  const hold       = await RoomHold.findOne({ userId }).sort({ createdAt: -1 });

  const previewPlan = {
    userId,
    bookingId: hold?._id || null,
    roomId:    user.roomTypeId,
    trackId:        isBooking ? 'booking' : trackId,
    chosenTrackId:  isBooking ? null      : trackId,
    components,
    phases,
    advanceCreditTotal:     isBooking ? advance : 0,
    advanceCreditConsumed:  0,
    advanceCreditRemaining: isBooking ? advance : 0,
  };

  // Compute the first amount BEFORE touching the DB
  const computed = isBooking
    ? engine.computeBookingAmountFromPlan(previewPlan)
    : await engine.computePhaseAmountFromPlan(previewPlan, 1, userId);

  // Snapshot finalAmount onto each phase (needed by approval logic to know
  // when partial payments cumulatively cover the phase).
  if (!isBooking) {
    for (const ph of previewPlan.phases) {
      if (ph.phaseNumber === 1) {
        ph.finalAmount = computed.finalAmount;
      } else {
        // Phase 2 (twopart) — compute its snapshot too
        try {
          const c2 = await engine.computePhaseAmountFromPlan(previewPlan, ph.phaseNumber, userId);
          ph.finalAmount = c2.finalAmount;
        } catch (_) {
          ph.finalAmount = 0;
        }
      }
    }
  }

  // Dedup transactionId
  const dup = await Payment.findOne({ transactionId: String(transactionId).trim() });
  if (dup) throw err('A payment with this transaction ID already exists', 409);

  // Partial support on first submission: accept clientAmount for non-booking tracks.
  let submitAmount;
  let isPartial = false;
  if (isBooking) {
    submitAmount = computed.finalAmount;
  } else if (clientAmount != null) {
    const n = Number(clientAmount);
    if (!Number.isFinite(n) || n <= 0) {
      throw err('amount must be a positive number', 400);
    }
    if (n > computed.finalAmount) {
      throw err(`amount exceeds Phase 1 total (₹${computed.finalAmount})`, 422);
    }
    submitAmount = Math.round(n);
    isPartial = submitAmount < computed.finalAmount;
  } else {
    submitAmount = computed.finalAmount;
  }

  // Persist the plan
  const plan = await PaymentPlan.create({
    ...previewPlan,
    createdBy: { userId, role: 'resident' },
  });

  // Persist the payment — rollback plan on failure
  let payment;
  try {
    payment = await Payment.create({
      userId,
      planId:    plan._id,
      bookingId: plan.bookingId || null,
      phaseNumber: isBooking ? null : 1,
      paymentType: paymentTypeFor(plan, 1),
      amount:               submitAmount,
      grossRent:            computed.grossRent || 0,
      discountAmount:       computed.discountAmount || 0,
      netRent:              computed.netRent || 0,
      nonRentalTotal:       computed.nonRentalTotal || 0,
      advanceCreditApplied: computed.advanceCreditApplied || 0,
      transactionId:   String(transactionId).trim(),
      receiptUrl:      String(receiptUrl).trim(),
      paymentMethod,
      paymentMethodV2: paymentMethod,
      status: 'pending',
      submittedAt: new Date(),
      isPartial,
    });
  } catch (e) {
    // Rollback plan so we don't leave an orphan
    await PaymentPlan.deleteOne({ _id: plan._id }).catch(() => {});
    throw e;
  }

  const payload = {
    paymentId:   payment._id,
    planId:      plan._id,
    phaseNumber: payment.phaseNumber,
    amount:      payment.amount,
    userId,
  };
  emitToAdmins('payment:submitted', payload);
  emitToUser(String(userId), 'payment:submitted', payload);

  return { payment, plan, breakdown: computed };
}

module.exports = {
  PAYMENT_METHODS,
  submitPayment,
  getHistory,
  getPaymentById,
};
