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
const engine      = require('./adjustmentEngine');
const { emitToAdmins, emitToUser } = require('./socketService');

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
  const { planId, phaseNumber, transactionId, receiptUrl, paymentMethod } = body;

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
  if (!planId) throw err('planId is required', 400);

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
    computed = await engine.computePhaseAmount(plan._id, Number(phaseNumber), userId);
  }

  // ── Dedup transactionId across payments ─────────────────────────────────────
  const dup = await Payment.findOne({ transactionId: String(transactionId).trim() });
  if (dup) throw err('A payment with this transaction ID already exists', 409);

  // ── Reject if a pending payment for this same phase exists ──────────────────
  const pendingExisting = await Payment.findOne({
    userId,
    planId: plan._id,
    phaseNumber: isBooking ? null : Number(phaseNumber),
    status: 'pending',
  });
  if (pendingExisting) throw err('A pending payment for this phase already exists', 409);

  // ── Create Payment ─────────────────────────────────────────────────────────
  const payment = await Payment.create({
    userId,
    planId:    plan._id,
    bookingId: plan.bookingId || null,
    phaseNumber: isBooking ? null : Number(phaseNumber),
    paymentType: paymentTypeFor(plan, Number(phaseNumber)),
    amount:               computed.finalAmount,
    grossRent:            computed.grossRent || 0,
    discountAmount:       computed.discountAmount || 0,
    netRent:              computed.netRent || 0,
    nonRentalTotal:       computed.nonRentalTotal || 0,
    advanceCreditApplied: computed.advanceCreditApplied || 0,
    transactionId:    String(transactionId).trim(),
    receiptUrl:       String(receiptUrl).trim(),
    paymentMethod:    paymentMethod, // legacy text field, mirrored
    paymentMethodV2:  paymentMethod,
    status: 'pending',
    submittedAt: new Date(),
  });

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

module.exports = {
  PAYMENT_METHODS,
  submitPayment,
  getHistory,
  getPaymentById,
};
