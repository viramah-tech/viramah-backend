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
const { startFinalPaymentTimer } = require('./timerService');
const Booking     = require('../models/Booking');

const err = (m, s = 400) => Object.assign(new Error(m), { statusCode: s });

// ── Listing / detail ──────────────────────────────────────────────────────────

async function listPayments({ status, paymentType, userId, planId, riskLevel, page = 1, limit = 20 } = {}) {
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

  // Enrich each payment with a computed riskScore + riskLevel
  const { getRiskLevel } = require('./paymentVerificationService');
  const enriched = payments.map(p => {
    const doc = p.toObject();
    const score = _computeInlineRiskScore(doc);
    doc.riskScore = score;
    doc.riskLevel = getRiskLevel(score);
    return doc;
  });

  // Post-query filter by riskLevel if requested
  let result = enriched;
  if (riskLevel) {
    const upper = riskLevel.toUpperCase();
    result = enriched.filter(p => p.riskLevel === upper);
  }

  return { payments: result, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

// Lightweight inline risk score — avoids DB round-trip per payment
function _computeInlineRiskScore(payment) {
  let score = 0;
  const ocr = payment.proofDocument?.ocrData;
  if (ocr?.extractedAmount && Math.abs(ocr.extractedAmount - payment.amount) > 10) score += 20;
  if (payment.duplicateCheck?.isDuplicate) score += 50;
  if (ocr?.confidenceScore != null && ocr.confidenceScore < 80) score += 10;
  if (payment.createdAt) {
    const ageHours = (Date.now() - new Date(payment.createdAt).getTime()) / 3600000;
    if (ageHours < 24) score += 5; // new user / recent
  }
  return Math.min(100, score);
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
        // Increment running total over approved partial payments
        phase.amountPaid = (phase.amountPaid || 0) + (payment.amount || 0);
        if (!phase.paymentIds) phase.paymentIds = [];
        phase.paymentIds.push(payment._id);
        phase.paymentId = payment._id; // legacy: last approved payment

        // Flip to 'paid' only when the running total covers the full phase
        // finalAmount snapshot. Otherwise keep it 'partially_paid'.
        const fullTotal = phase.finalAmount || 0;
        if (fullTotal > 0 && phase.amountPaid >= fullTotal) {
          phase.status = 'paid';
          phase.paidOn = new Date();
        } else {
          phase.status = 'partially_paid';
        }
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

/**
 * Approve a BOOKING payment — lighter than the 9-step rent approval.
 * 1. Verify payment status === 'pending'
 * 2. Set Payment.status = 'approved'
 * 3. Create credit Transaction
 * 4. Update Booking.status = 'BOOKING_CONFIRMED'
 * 5. Start 7-day final payment timer
 * 6. Update User.paymentProfile.paymentStatus
 * 7. Emit socket event
 * 8. Create AuditLog entry
 */
async function approveBookingPayment(paymentId, actor) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw err('Payment not found', 404);
  if (payment.status !== 'pending') throw err(`Cannot approve a payment with status '${payment.status}'`, 400);

  const booking = await Booking.findById(payment.bookingId);
  if (!booking) throw err('Linked booking not found', 404);

  payment.status = 'approved';
  payment.reviewedBy = actor || {};
  payment.reviewedAt = new Date();
  
  // Create Ledger Txn
  const lastTxn = await Transaction.findOne({ userId: payment.userId }).sort({ createdAt: -1 });
  const balanceBefore = lastTxn?.balanceAfter ?? 0;
  const balanceAfter = balanceBefore + (payment.amount || 0);

  const txn = await Transaction.create({
    paymentId: payment._id,
    bookingId: payment.bookingId,
    userId: payment.userId,
    sourceType: 'payment',
    sourceId: payment._id,
    direction: 'credit',
    type: 'credit',
    amount: payment.amount,
    description: `Booking Payment approved`,
    status: 'completed',
    postingStatus: 'posted',
    postedAt: new Date(),
    balanceBefore,
    balanceAfter,
  });

  payment.transactionRef = txn._id;
  await payment.save();

  // Update Booking
  booking.status = 'BOOKING_CONFIRMED';
  booking.financials.totalPaid = payment.amount;
  booking.version = (booking.version || 0) + 1;
  await booking.save();

  // Start 7-day timer
  const expiryDate = await startFinalPaymentTimer(booking._id, 7);

  // Update user profile
  await User.findByIdAndUpdate(payment.userId, { 
    'paymentProfile.paymentStatus': 'BOOKING_CONFIRMED',
    paymentStatus: 'approved' // legacy
  });

  emitToUser(String(payment.userId), 'payment:approved', {
    paymentId: payment._id,
    bookingId: booking._id,
    status: 'BOOKING_CONFIRMED',
    finalPaymentDeadline: expiryDate
  });

  await AuditLog.create({
    userId: actor?.userId || null,
    userName: actor?.name || '',
    userRole: actor?.role || '',
    action: 'BOOKING_APPROVED',
    resource: 'payment',
    resourceId: String(payment._id),
    method: 'PATCH',
    path: `/api/admin/payments/${payment._id}/approve-booking`,
    statusCode: 200,
  });

  return { payment, booking, transaction: txn };
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

  // R5.5: Send rejection notification email (non-blocking)
  try {
    const User = require('../models/User');
    const user = await User.findById(payment.userId).select('name email userId').lean();
    if (user?.email) {
      const { sendEmail } = require('./emailService');
      const firstName = (user.name || 'there').split(' ')[0];
      await sendEmail({
        to: user.email,
        subject: 'Payment Update — Viramah Student Living',
        html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); border-radius: 12px; padding: 32px; color: #fff; margin-bottom: 24px;">
            <h1 style="margin: 0 0 8px; font-size: 22px;">Payment Update</h1>
            <p style="margin: 0; opacity: 0.8;">Viramah Student Living</p>
          </div>
          <div style="padding: 0 8px;">
            <p style="font-size: 16px; color: #334155;">Hi ${firstName},</p>
            <p style="font-size: 15px; color: #475569; line-height: 1.6;">
              Your payment of <strong>₹${(payment.amount || 0).toLocaleString('en-IN')}</strong> has been
              <strong style="color: #dc2626;">not approved</strong>.
            </p>
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="margin: 0; color: #991b1b; font-size: 14px;">
                <strong>Reason:</strong> ${payment.reviewRemarks || 'Please contact admin for details.'}
              </p>
            </div>
            <p style="font-size: 15px; color: #475569;">
              If you believe this is an error, please contact the admin team. You may re-submit your payment with the correct details.
            </p>
          </div>
          <div style="border-top: 1px solid #e2e8f0; margin-top: 32px; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center;">
            Viramah Student Living
          </div>
        </div>`,
      });
    }
  } catch (emailErr) {
    console.error('[rejectPayment] Notification email failed (non-fatal):', emailErr.message);
  }

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

async function recordManualPayment({ userId, planId, phaseNumber, amount, transactionId, receiptUrl, paymentMethod, description, autoApprove = true, actor }) {
  if (!userId || !amount || !transactionId || !receiptUrl || !paymentMethod) {
    throw err('userId, amount, transactionId, receiptUrl, and paymentMethod are required', 400);
  }

  // Dedup transactionId
  const dup = await Payment.findOne({ transactionId: String(transactionId).trim() });
  if (dup) throw err('A payment with this transaction ID already exists', 409);

  // If planId is provided, compute breakdown via engine for audit trail
  let computed = null;
  let paymentType = 'manual_admin';
  if (planId && phaseNumber) {
    try {
      computed = await engine.computePhaseAmount(planId, Number(phaseNumber), userId);
    } catch (_) { /* non-critical — use manual amount */ }
  }

  const payment = await Payment.create({
    userId,
    planId:    planId || null,
    phaseNumber: phaseNumber ? Number(phaseNumber) : null,
    paymentType,
    amount:               computed ? computed.finalAmount : amount,
    grossRent:            computed?.grossRent || null,
    discountAmount:       computed?.discountAmount || null,
    netRent:              computed?.netRent || null,
    nonRentalTotal:       computed?.nonRentalTotal || null,
    advanceCreditApplied: computed?.advanceCreditApplied || null,
    transactionId: String(transactionId).trim(),
    receiptUrl:    String(receiptUrl).trim(),
    paymentMethod,
    paymentMethodV2: paymentMethod,
    description: description || 'Admin-recorded manual payment',
    status: 'pending',
    submittedAt: new Date(),
  });

  if (autoApprove) {
    return approvePayment(payment._id, actor);
  }
  return { payment, computed };
}

// ── Bulk approve ──────────────────────────────────────────────────────────────

async function bulkApprove(paymentIds, actor) {
  if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
    throw err('paymentIds must be a non-empty array', 400);
  }
  if (paymentIds.length > 50) {
    throw err('Cannot bulk approve more than 50 payments at once', 400);
  }

  const results = { approved: [], failed: [] };
  for (const id of paymentIds) {
    try {
      const result = await approvePayment(id, actor);
      results.approved.push({ paymentId: id, amount: result.payment.amount });
    } catch (e) {
      results.failed.push({ paymentId: id, reason: e.message });
    }
  }
  return results;
}

// ── Bulk reject ───────────────────────────────────────────────────────────────

async function bulkReject(paymentIds, reason, actor) {
  if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
    throw err('paymentIds must be a non-empty array', 400);
  }
  if (!reason || !String(reason).trim()) {
    throw err('reason is required for bulk reject', 400);
  }
  if (paymentIds.length > 50) {
    throw err('Cannot bulk reject more than 50 payments at once', 400);
  }

  const results = { rejected: [], failed: [] };
  for (const id of paymentIds) {
    try {
      await rejectPayment(id, { reason, actor });
      results.rejected.push({ paymentId: id });
    } catch (e) {
      results.failed.push({ paymentId: id, reason: e.message });
    }
  }
  return results;
}

// ── Get payment summary stats (unified V1+V2) ────────────────────────────────

async function getUnifiedStats() {
  const [byStatus, totalCollected] = await Promise.all([
    Payment.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
    ]),
    Payment.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const stats = { total: 0, pending: 0, approved: 0, rejected: 0, on_hold: 0, upcoming: 0, disputed: 0, totalCollected: 0 };
  byStatus.forEach((s) => {
    stats[s._id] = s.count;
    stats.total += s.count;
  });
  stats.totalCollected = totalCollected[0]?.total || 0;
  return stats;
}

module.exports = {
  listPayments,
  getPaymentDetail,
  approvePayment,
  approveBookingPayment,
  rejectPayment,
  holdPayment,
  recordManualPayment,
  bulkApprove,
  bulkReject,
  getUnifiedStats,
};
