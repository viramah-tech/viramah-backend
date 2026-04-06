'use strict';

/**
 * paymentReviewService — admin payment review + the atomic 9-step approval flow.
 * Plan Section 4.4 + Phase D critical rule.
 *
 * Approval atomically (logical all-or-nothing — DocumentDB lacks reliable
 * cross-collection transactions, so we order operations to fail safely):
 *
 *   1. payment.status = 'approved'
 *   2. Create transaction with postingStatus='posted'   ← fixes audit gap
 *   3. payment.transactionRef = transaction._id
 *   4. plan phase: status='paid', paidOn, paymentId
 *   5. plan.advanceCreditConsumed/Remaining if booking carry
 *   6. user.paymentStatus
 *   7. Phase 2 stays locked if Phase 1 just approved
 *   8. emit payment:approved
 *   9. write auditlog
 *
 * Rejection: payment.status='rejected', socket payment:rejected, no ledger entry.
 * Hold:      payment.status='on_hold', socket payment:on_hold.
 */

const Payment     = require('../models/Payment');
const Transaction = require('../models/Transaction');
const PaymentPlan = require('../models/PaymentPlan');
const User        = require('../models/User');
const AuditLog    = require('../models/AuditLog');
const engine      = require('./adjustmentEngine');
const { emitToAdmins, emitToUser } = require('./socketService');

const err = (m, s = 400) => Object.assign(new Error(m), { statusCode: s });

// ── Listing / detail ──────────────────────────────────────────────────────────

async function listPayments({ status, paymentType, userId, planId, page = 1, limit = 20 } = {}) {
  const q = {};
  if (status)      q.status = status;
  if (paymentType) q.paymentType = paymentType;
  if (userId)      q.userId = userId;
  if (planId)      q.planId = planId;

  const skip = (page - 1) * limit;
  const [payments, total] = await Promise.all([
    Payment.find(q)
      .populate('userId', 'userId name email phone roomNumber')
      .sort({ submittedAt: -1, createdAt: -1 })
      .skip(skip).limit(limit),
    Payment.countDocuments(q),
  ]);
  return { payments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function getPaymentDetail(paymentId) {
  const payment = await Payment.findById(paymentId)
    .populate('userId', 'userId name email phone roomNumber')
    .populate('transactionRef');
  if (!payment) throw err('Payment not found', 404);

  let plan = null;
  let computed = null;
  if (payment.planId) {
    plan = await PaymentPlan.findById(payment.planId);
    if (plan) {
      try {
        computed = payment.phaseNumber
          ? await engine.computePhaseAmount(plan._id, payment.phaseNumber, payment.userId)
          : await engine.computeBookingAmount(plan._id);
      } catch (_) { /* engine errors should not block detail view */ }
    }
  }
  return { payment, plan, computed };
}

// ── Approve (the atomic 9-step flow) ──────────────────────────────────────────

async function approvePayment(paymentId, actor) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw err('Payment not found', 404);
  if (payment.status !== 'pending') {
    throw err(`Cannot approve a payment with status '${payment.status}'`, 400);
  }

  const plan = payment.planId ? await PaymentPlan.findById(payment.planId) : null;

  // 1. Mark approved + reviewer info
  payment.status        = 'approved';
  payment.reviewedBy    = actor || {};
  payment.reviewedAt    = new Date();
  payment.reviewRemarks = null;

  // 2. Compute running balance for ledger entry
  const lastTxn = await Transaction.findOne({ userId: payment.userId }).sort({ createdAt: -1 });
  const balanceBefore = lastTxn?.balanceAfter ?? 0;
  const balanceAfter  = balanceBefore + (payment.amount || 0);

  // 3. Create the Transaction with postingStatus='posted' (audit-gap fix)
  const txn = await Transaction.create({
    paymentId:     payment._id,
    planId:        payment.planId || null,
    bookingId:     payment.bookingId || null,
    userId:        payment.userId,
    sourceType:    'payment',
    sourceId:      payment._id,
    direction:     'credit',
    type:          'credit',          // legacy enum
    typeV2:        'rent',            // best-effort
    amount:        payment.amount,
    description:   `Payment ${payment.paymentType} approved`,
    status:        'completed',
    postingStatus: 'posted',
    postedAt:      new Date(),
    balanceBefore,
    balanceAfter,
    installmentNumber: payment.phaseNumber || null,
  });

  // 4. Link payment → transaction
  payment.transactionRef = txn._id;
  await payment.save();

  // 5. Update plan phase
  if (plan) {
    if (payment.phaseNumber) {
      const phase = plan.phases.find((p) => p.phaseNumber === payment.phaseNumber);
      if (phase) {
        phase.status    = 'paid';
        phase.paidOn    = new Date();
        phase.paymentId = payment._id;
      }
    }

    // 6. Advance credit accounting
    if (payment.advanceCreditApplied && payment.advanceCreditApplied > 0) {
      plan.advanceCreditConsumed  = (plan.advanceCreditConsumed || 0) + payment.advanceCreditApplied;
      plan.advanceCreditRemaining = Math.max(0, (plan.advanceCreditRemaining || 0) - payment.advanceCreditApplied);
    }

    // 7. Plan completion check (all phases paid)
    if (plan.phases.length > 0 && plan.phases.every((p) => p.status === 'paid')) {
      plan.status = 'completed';
    }

    await plan.save();
  }

  // 8. Sync user.paymentStatus
  await User.findByIdAndUpdate(payment.userId, { paymentStatus: 'approved' });

  // 9. Socket event + audit log
  emitToUser(String(payment.userId), 'payment:approved', {
    paymentId:   payment._id,
    planId:      payment.planId,
    phaseNumber: payment.phaseNumber,
    transactionRef: txn._id,
    reviewedBy:  actor || null,
  });

  await AuditLog.create({
    userId:    actor?.userId || null,
    userName:  actor?.name   || '',
    userRole:  actor?.role   || '',
    action:    'PAYMENT_APPROVED',
    resource:  'payment',
    resourceId: String(payment._id),
    method:    'PATCH',
    path:      `/api/admin/payments/${payment._id}/approve`,
    requestBody: {},
    statusCode: 200,
  });

  return { payment, transaction: txn };
}

// ── Reject ────────────────────────────────────────────────────────────────────

async function rejectPayment(paymentId, { reason, actor }) {
  if (!reason || !String(reason).trim()) throw err('reason is required to reject a payment', 400);

  const payment = await Payment.findById(paymentId);
  if (!payment) throw err('Payment not found', 404);
  if (payment.status === 'approved') throw err('Cannot reject an already approved payment', 400);

  payment.status        = 'rejected';
  payment.reviewedBy    = actor || {};
  payment.reviewedAt    = new Date();
  payment.reviewRemarks = String(reason).trim();
  payment.remarks       = String(reason).trim();
  await payment.save();

  await User.findByIdAndUpdate(payment.userId, { paymentStatus: 'rejected' });

  emitToUser(String(payment.userId), 'payment:rejected', {
    paymentId:   payment._id,
    planId:      payment.planId,
    phaseNumber: payment.phaseNumber,
    reason:      payment.reviewRemarks,
    reviewedBy:  actor || null,
  });

  await AuditLog.create({
    userId: actor?.userId || null, userName: actor?.name || '', userRole: actor?.role || '',
    action: 'PAYMENT_REJECTED', resource: 'payment', resourceId: String(payment._id),
    method: 'PATCH', path: `/api/admin/payments/${payment._id}/reject`,
    requestBody: { reason }, statusCode: 200,
  });

  return payment;
}

// ── Hold ──────────────────────────────────────────────────────────────────────

async function holdPayment(paymentId, { reason, actor }) {
  if (!reason || !String(reason).trim()) throw err('reason is required', 400);
  const payment = await Payment.findById(paymentId);
  if (!payment) throw err('Payment not found', 404);
  if (payment.status !== 'pending') throw err(`Cannot hold a payment with status '${payment.status}'`, 400);

  payment.status        = 'on_hold';
  payment.reviewedBy    = actor || {};
  payment.reviewedAt    = new Date();
  payment.reviewRemarks = String(reason).trim();
  await payment.save();

  emitToAdmins('payment:on_hold', { paymentId: payment._id, reason: payment.reviewRemarks });

  return payment;
}

// ── Manual offline payment ────────────────────────────────────────────────────

async function recordManualPayment({ userId, planId, phaseNumber, amount, transactionId, receiptUrl, paymentMethod, description, actor }) {
  if (!userId || !amount || !transactionId || !receiptUrl || !paymentMethod) {
    throw err('userId, amount, transactionId, receiptUrl, and paymentMethod are required', 400);
  }
  const payment = await Payment.create({
    userId,
    planId:    planId || null,
    phaseNumber: phaseNumber || null,
    paymentType: 'manual_admin',
    amount,
    transactionId, receiptUrl, paymentMethod, paymentMethodV2: paymentMethod,
    description: description || 'Admin-recorded manual payment',
    status: 'pending', // still goes through approval atomic flow
    submittedAt: new Date(),
  });
  // Auto-approve since admin recorded it
  return approvePayment(payment._id, actor);
}

module.exports = {
  listPayments,
  getPaymentDetail,
  approvePayment,
  rejectPayment,
  holdPayment,
  recordManualPayment,
};
