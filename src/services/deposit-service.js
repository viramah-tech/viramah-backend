'use strict';

/**
 * depositService.js — Business logic for the Room Deposit & Hold Policy.
 *
 * Flow:
 *   1. resident calls initiateDeposit → RoomHold (pending_approval)
 *   2. admin calls approveDeposit → RoomHold (active), clock starts
 *   3a. resident calls requestRefund (within 7 days) → RefundRecord (requested)
 *       admin calls approveRefund → RoomHold (refunded), room released
 *   3b. OR resident calls initiatePayment (Phase 1) → deposit credited → RoomHold (converted)
 *   3c. OR 21-day deadline passes → expireOverdueHolds() → RoomHold (expired), room released
 */

const RoomHold    = require('../models/RoomHold');
const RefundRecord = require('../models/RefundRecord');
const RoomType    = require('../models/RoomType');
const User        = require('../models/User');
const { getPricingConfig } = require('./pricingService');

const REFUND_WINDOW_DAYS    = 7;
const PAYMENT_WINDOW_DAYS   = 21;

/**
 * Loads deposit-related constants from PricingConfig (cached 60s).
 * This is the single source of truth — NO hardcoded amounts.
 */
const getDepositConstants = async () => {
  const cfg = await getPricingConfig();
  return {
    DEPOSIT_AMOUNT:        cfg.securityDeposit,     // ₹15,000
    REGISTRATION_FEE:      cfg.registrationFee,     // ₹1,000
    TOTAL_DEPOSIT_PAYMENT: cfg.securityDeposit + cfg.registrationFee, // ₹16,000
  };
};

// ── helpers ───────────────────────────────────────────────────────────────────

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const auditLog = (event, data) =>
  console.info(JSON.stringify({ event, ...data, timestamp: new Date().toISOString() }));

// ── initiateDeposit ───────────────────────────────────────────────────────────

/**
 * Resident initiates a deposit payment — creates a RoomHold in pending_approval.
 * Admin must approve it to start the clock.
 *
 * @param {string} userId
 * @param {string} roomTypeId
 * @param {string} paymentMode - 'full' | 'half' | 'deposit'
 * @param {{ transactionId: string, receiptUrl: string, totalAmount?: number }} transactionDetails
 * @returns {Promise<RoomHold>}
 */
const initiateDeposit = async (userId, roomTypeId, paymentMode, { transactionId, receiptUrl, totalAmount }) => {
  if (!['full', 'half', 'deposit'].includes(paymentMode)) {
    const err = new Error('paymentMode must be "full", "half", or "deposit".');
    err.statusCode = 400;
    throw err;
  }

  // Check for existing active/pending hold — one per user
  const existing = await RoomHold.findOne({
    userId,
    status: { $in: ['pending_approval', 'active'] },
  });

  if (existing) {
    const err = new Error(
      existing.status === 'pending_approval'
        ? 'A deposit is already pending admin approval. Please wait.'
        : 'You already have an active room hold. Complete your payment or request a refund first.'
    );
    err.statusCode = 409;
    throw err;
  }

  // Validate RoomType exists and has capacity
  const roomType = await RoomType.findById(roomTypeId);
  if (!roomType) {
    const err = new Error('Room type not found.');
    err.statusCode = 404;
    throw err;
  }
  if (roomType.availableSeats <= 0) {
    const err = new Error('No available seats for this room type at this time.');
    err.statusCode = 409;
    throw err;
  }

  // AUDIT FIX C-2: Validate onboarding is completed before deposit initiation.
  const depositUser = await User.findById(userId).lean();
  if (depositUser && depositUser.onboardingStatus !== 'completed') {
    const err = new Error('Please complete your profile before making a deposit.');
    err.statusCode = 422;
    throw err;
  }

  // Load deposit constants from PricingConfig (single source of truth)
  const { DEPOSIT_AMOUNT, REGISTRATION_FEE, TOTAL_DEPOSIT_PAYMENT } = await getDepositConstants();

  // For deposit-only mode: store the registration fee and total paid as server-side constants.
  const isDepositOnly = paymentMode === 'deposit';

  // Flexible advance: user can pay more than the minimum ₹16,000.
  // totalAmount is the amount the user claims to have paid.
  // If not provided, defaults to the mandatory minimum.
  const effectiveTotalAmount = isDepositOnly
    ? Math.max(totalAmount || TOTAL_DEPOSIT_PAYMENT, TOTAL_DEPOSIT_PAYMENT)
    : 0;

  // Validate: totalAmount must be >= mandatory minimum
  if (isDepositOnly && totalAmount && totalAmount < TOTAL_DEPOSIT_PAYMENT) {
    const err = new Error(
      `Minimum deposit is ₹${TOTAL_DEPOSIT_PAYMENT.toLocaleString('en-IN')} ` +
      `(₹${DEPOSIT_AMOUNT.toLocaleString('en-IN')} security + ₹${REGISTRATION_FEE.toLocaleString('en-IN')} registration). ` +
      `You entered ₹${totalAmount.toLocaleString('en-IN')}.`
    );
    err.statusCode = 422;
    throw err;
  }

  // Calculate advance: anything above the mandatory ₹16,000
  const advanceAmount = isDepositOnly
    ? Math.max(0, effectiveTotalAmount - TOTAL_DEPOSIT_PAYMENT)
    : 0;

  const hold = await RoomHold.create({
    userId,
    roomTypeId,
    paymentMode,
    depositAmount:           DEPOSIT_AMOUNT,
    registrationFeePaid:     isDepositOnly ? REGISTRATION_FEE : 0,
    advanceAmount,
    totalPaidAtDeposit:      effectiveTotalAmount,
    depositTransactionId:    transactionId || '',
    depositReceiptUrl:       receiptUrl    || '',
    status:                  'pending_approval',
  });

  auditLog('DEPOSIT_INITIATED', {
    userId, roomTypeId, paymentMode, holdId: hold._id,
    isDepositOnly, totalPaidAtDeposit: hold.totalPaidAtDeposit,
    advanceAmount, effectiveTotalAmount,
  });

  return hold;
};

// ── approveDeposit ────────────────────────────────────────────────────────────

/**
 * Admin approves a pending deposit. Starts the refund + payment deadline clocks.
 * Decrements RoomType.availableSeats (room is now held).
 *
 * @param {string} holdId
 * @param {string} adminId
 * @returns {Promise<RoomHold>}
 */
const approveDeposit = async (holdId, adminId) => {
  const hold = await RoomHold.findById(holdId);

  if (!hold) {
    const err = new Error('Room hold not found.');
    err.statusCode = 404;
    throw err;
  }
  if (hold.status !== 'pending_approval') {
    const err = new Error(`Cannot approve a hold with status '${hold.status}'.`);
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  hold.status          = 'active';
  hold.depositPaidAt   = now;
  hold.refundDeadline  = addDays(now, REFUND_WINDOW_DAYS);
  hold.paymentDeadline = addDays(now, PAYMENT_WINDOW_DAYS);
  hold.approvedBy      = adminId;
  await hold.save();

  // Decrement available capacity on RoomType (seat is now held)
  await RoomType.findByIdAndUpdate(hold.roomTypeId, {
    $inc: { bookedSeats: 1 },
  });

  auditLog('DEPOSIT_APPROVED', {
    holdId: hold._id,
    userId: hold.userId,
    adminId,
    refundDeadline:  hold.refundDeadline,
    paymentDeadline: hold.paymentDeadline,
  });

  return hold;
};

// ── requestRefund ─────────────────────────────────────────────────────────────

/**
 * Resident requests a refund. Only valid within the 7-day refund window.
 * Creates a RefundRecord with status 'requested' — admin must approve.
 *
 * @param {string} userId
 * @param {string} reason
 * @returns {Promise<RefundRecord>}
 */
const requestRefund = async (userId, reason = '') => {
  const hold = await RoomHold.findOne({ userId, status: 'active' });

  if (!hold) {
    const err = new Error('No active room hold found for your account.');
    err.statusCode = 404;
    throw err;
  }

  const now = new Date();
  if (now > hold.refundDeadline) {
    const err = new Error(
      'Refund window has expired. The ₹15,000 deposit is non-refundable after 7 days of payment.'
    );
    err.statusCode = 422;
    throw err;
  }

  if (hold.refundRequestedAt) {
    const err = new Error('A refund request has already been submitted. Please wait for admin review.');
    err.statusCode = 409;
    throw err;
  }

  hold.refundRequestedAt = now;
  await hold.save();

  // Refundable total: security deposit + advance amount (registration fee NEVER refunded)
  const refundableTotal = hold.depositAmount + (hold.advanceAmount || 0);

  const refundRecord = await RefundRecord.create({
    roomHoldId:  hold._id,
    userId,
    amount:      refundableTotal,
    reason,
    requestedAt: now,
    status:      'requested',
  });

  auditLog('REFUND_REQUESTED', { holdId: hold._id, userId, refundRecordId: refundRecord._id });

  return refundRecord;
};

// ── approveRefund ─────────────────────────────────────────────────────────────

/**
 * Admin approves a refund request.
 * Re-validates the refund deadline (safety check even if requestRefund already checked).
 * Releases the room back to available pool.
 *
 * @param {string} refundRecordId
 * @param {string} adminId
 * @returns {Promise<RefundRecord>}
 */
const approveRefund = async (refundRecordId, adminId) => {
  const refundRecord = await RefundRecord.findById(refundRecordId).populate('roomHoldId');

  if (!refundRecord) {
    const err = new Error('Refund record not found.');
    err.statusCode = 404;
    throw err;
  }
  if (refundRecord.status !== 'requested') {
    const err = new Error(`Refund is already '${refundRecord.status}'.`);
    err.statusCode = 400;
    throw err;
  }

  const hold = refundRecord.roomHoldId;
  if (!hold) {
    const err = new Error('Associated room hold not found.');
    err.statusCode = 404;
    throw err;
  }

  // Safety re-validation of deadline (admin UI might lag)
  const now = new Date();
  if (now > hold.refundDeadline) {
    const err = new Error(
      'Refund deadline has now passed. Refund can no longer be approved.'
    );
    err.statusCode = 422;
    throw err;
  }

  // Approve the refund record
  refundRecord.status     = 'approved';
  refundRecord.approvedAt = now;
  refundRecord.approvedBy = adminId;
  await refundRecord.save();

  // Update RoomHold
  hold.status             = 'refunded';
  hold.refundApprovedAt   = now;
  hold.refundApprovedBy   = adminId;
  await hold.save();

  // Release the seat back to available pool
  await RoomType.findByIdAndUpdate(hold.roomTypeId, {
    $inc: { bookedSeats: -1 },
  });

  auditLog('REFUND_APPROVED', {
    refundRecordId,
    holdId: hold._id,
    userId: hold.userId,
    adminId,
    amount: refundRecord.amount,
  });

  return refundRecord;
};

// ── rejectRefund ──────────────────────────────────────────────────────────────

/**
 * Admin rejects a refund request. Hold stays active; room is NOT released.
 *
 * @param {string} refundRecordId
 * @param {string} adminId
 * @param {string} rejectionReason
 * @returns {Promise<RefundRecord>}
 */
const rejectRefund = async (refundRecordId, adminId, rejectionReason = '') => {
  const refundRecord = await RefundRecord.findById(refundRecordId).populate('roomHoldId');

  if (!refundRecord) {
    const err = new Error('Refund record not found.');
    err.statusCode = 404;
    throw err;
  }
  if (refundRecord.status !== 'requested') {
    const err = new Error(`Refund is already '${refundRecord.status}'.`);
    err.statusCode = 400;
    throw err;
  }

  refundRecord.status          = 'rejected';
  refundRecord.rejectedAt      = new Date();
  refundRecord.rejectedBy      = adminId;
  refundRecord.rejectionReason = rejectionReason;
  await refundRecord.save();

  // Clear refundRequestedAt on hold so user can request again if still within window
  await RoomHold.findByIdAndUpdate(refundRecord.roomHoldId._id, {
    $unset: { refundRequestedAt: '' },
  });

  auditLog('REFUND_REJECTED', { refundRecordId, adminId, rejectionReason });

  return refundRecord;
};

// ── getDepositCredit ──────────────────────────────────────────────────────────

/**
 * Checks if a user has a valid active RoomHold deposit to credit toward their payment.
 * Called by paymentService.initiatePayment before calling pricingService.
 *
 * @param {string} userId
 * @returns {Promise<{ hasDeposit: boolean, creditAmount: number, holdId: string|null }>}
 */
const getDepositCredit = async (userId) => {
  const hold = await RoomHold.findOne({ userId, status: 'active' }).lean();

  if (!hold) return { hasDeposit: false, creditAmount: 0, holdId: null };

  const now = new Date();

  // Payment window must still be open
  if (now > hold.paymentDeadline) {
    // Hold has expired — will be cleaned up by cron
    return { hasDeposit: false, creditAmount: 0, holdId: hold._id.toString() };
  }

  // Total credit = security deposit + any advance amount paid
  const totalCredit = hold.depositAmount + (hold.advanceAmount || 0);

  return {
    hasDeposit:   true,
    creditAmount: totalCredit,
    holdId:       hold._id.toString(),
  };
};

// ── markHoldConverted ─────────────────────────────────────────────────────────

/**
 * Marks the user's active RoomHold as converted after successful full payment.
 * Called by paymentService.initiatePayment after creating the Payment record.
 *
 * @param {string} userId
 * @param {string} paymentId - ObjectId of the created Payment
 * @returns {Promise<void>}
 */
const markHoldConverted = async (userId, paymentId) => {
  const hold = await RoomHold.findOne({ userId, status: 'active' });
  if (!hold) return; // No active hold — no action needed

  hold.status                = 'converted';
  hold.convertedAt           = new Date();
  hold.convertedByPaymentId  = paymentId;
  await hold.save();

  auditLog('HOLD_CONVERTED', { holdId: hold._id, userId, paymentId });
};

// ── expireOverdueHolds ────────────────────────────────────────────────────────

/**
 * Finds all active RoomHolds where paymentDeadline has passed and marks them expired.
 * Room capacity is released back to the available pool.
 *
 * TODO: Hook this into a daily cron job using node-cron or a cloud scheduler.
 *       Example: schedule.cron('0 2 * * *', expireOverdueHolds); // 2am daily
 *
 * @returns {Promise<number>} count of holds expired
 */
const expireOverdueHolds = async () => {
  const now = new Date();

  const overdueHolds = await RoomHold.find({
    status:          'active',
    paymentDeadline: { $lt: now },
  });

  let count = 0;
  for (const hold of overdueHolds) {
    hold.status    = 'expired';
    hold.expiredAt = now;
    await hold.save();

    // Release the held seat back to available pool
    await RoomType.findByIdAndUpdate(hold.roomTypeId, {
      $inc: { bookedSeats: -1 },
    });

    auditLog('HOLD_EXPIRED', {
      holdId:          hold._id,
      userId:          hold.userId,
      paymentDeadline: hold.paymentDeadline,
    });

    count++;
  }

  if (count > 0) {
    console.info(`[depositService] expireOverdueHolds: expired ${count} hold(s).`);
  }

  return count;
};

// ── getHoldStatus (computed fields) ───────────────────────────────────────────

/**
 * Returns a RoomHold with computed UI-friendly fields attached.
 *
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
const getHoldStatus = async (userId) => {
  const hold = await RoomHold.findOne({
    userId,
    status: { $in: ['pending_approval', 'active', 'converted', 'refunded', 'expired'] },
  })
    .sort({ createdAt: -1 })
    .populate('roomTypeId', 'name displayName')
    .lean();

  if (!hold) return null;

  const now = Date.now();

  const daysUntilRefundDeadline = hold.refundDeadline
    ? Math.ceil((new Date(hold.refundDeadline) - now) / (1000 * 60 * 60 * 24))
    : null;

  const daysUntilPaymentDeadline = hold.paymentDeadline
    ? Math.ceil((new Date(hold.paymentDeadline) - now) / (1000 * 60 * 60 * 24))
    : null;

  return {
    ...hold,
    daysUntilRefundDeadline,
    daysUntilPaymentDeadline,
    isRefundEligible:     hold.status === 'active' && daysUntilRefundDeadline > 0 && !hold.refundRequestedAt,
    isPaymentWindowOpen:  hold.status === 'active' && daysUntilPaymentDeadline > 0,
  };
};

// ── getDepositOnlyStatus ──────────────────────────────────────────────────────

/**
 * Returns enriched hold status specifically for deposit-only payment mode.
 * Includes refundableAmount vs nonRefundableAmount for frontend display.
 *
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
const getDepositOnlyStatus = async (userId) => {
  const hold = await getHoldStatus(userId);
  if (!hold) return null;

  const { DEPOSIT_AMOUNT, REGISTRATION_FEE, TOTAL_DEPOSIT_PAYMENT } = await getDepositConstants();
  const isDepositOnly = hold.paymentMode === 'deposit';
  const advance = hold.advanceAmount || 0;

  return {
    ...hold,
    advanceAmount:        advance,
    totalPaidAtDeposit:   isDepositOnly ? (hold.totalPaidAtDeposit || TOTAL_DEPOSIT_PAYMENT + advance) : null,
    refundableAmount:     isDepositOnly ? (DEPOSIT_AMOUNT + advance) : hold.depositAmount,
    nonRefundableAmount:  isDepositOnly ? REGISTRATION_FEE : 0,
  };
};

// ── adminCreateDeposit ────────────────────────────────────────────────────────

/**
 * Admin creates a deposit hold on behalf of a walk-in resident.
 * Bypasses the onboarding check since admin is manually entering.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.roomTypeId
 * @param {string} params.paymentMode - 'full' | 'half' | 'deposit'
 * @param {string} params.transactionId
 * @param {string} params.receiptUrl
 * @param {number} [params.totalAmount]
 * @param {boolean} [params.autoApprove=false]
 * @param {string} params.adminId
 * @returns {Promise<RoomHold>}
 */
const adminCreateDeposit = async ({ userId, roomTypeId, paymentMode, transactionId, receiptUrl, totalAmount, autoApprove = false, adminId }) => {
  if (!userId || !roomTypeId || !paymentMode) {
    const err = new Error('userId, roomTypeId, and paymentMode are required.');
    err.statusCode = 400;
    throw err;
  }
  if (!['full', 'half', 'deposit'].includes(paymentMode)) {
    const err = new Error('paymentMode must be "full", "half", or "deposit".');
    err.statusCode = 400;
    throw err;
  }

  // Block if user already has active/pending hold
  const existing = await RoomHold.findOne({
    userId,
    status: { $in: ['pending_approval', 'active'] },
  });
  if (existing) {
    const err = new Error('User already has an active or pending deposit hold.');
    err.statusCode = 409;
    throw err;
  }

  const roomType = await RoomType.findById(roomTypeId);
  if (!roomType) {
    const err = new Error('Room type not found.');
    err.statusCode = 404;
    throw err;
  }

  const { DEPOSIT_AMOUNT, REGISTRATION_FEE, TOTAL_DEPOSIT_PAYMENT } = await getDepositConstants();
  const isDepositOnly = paymentMode === 'deposit';
  const effectiveTotalAmount = isDepositOnly
    ? Math.max(totalAmount || TOTAL_DEPOSIT_PAYMENT, TOTAL_DEPOSIT_PAYMENT)
    : 0;
  const advanceAmount = isDepositOnly
    ? Math.max(0, effectiveTotalAmount - TOTAL_DEPOSIT_PAYMENT)
    : 0;

  const hold = await RoomHold.create({
    userId,
    roomTypeId,
    paymentMode,
    depositAmount:        DEPOSIT_AMOUNT,
    registrationFeePaid:  isDepositOnly ? REGISTRATION_FEE : 0,
    advanceAmount,
    totalPaidAtDeposit:   effectiveTotalAmount,
    depositTransactionId: transactionId || '',
    depositReceiptUrl:    receiptUrl || '',
    status:               'pending_approval',
  });

  auditLog('ADMIN_DEPOSIT_CREATED', {
    holdId: hold._id, userId, roomTypeId, paymentMode, adminId,
    totalPaidAtDeposit: hold.totalPaidAtDeposit,
  });

  // Auto-approve if requested
  if (autoApprove) {
    return approveDeposit(hold._id.toString(), adminId);
  }

  return hold;
};

// ── extendDeadline ────────────────────────────────────────────────────────────

/**
 * Admin extends refund and/or payment deadlines for an active hold.
 *
 * @param {string} holdId
 * @param {Object} dates
 * @param {string} [dates.newRefundDeadline]  - ISO date string
 * @param {string} [dates.newPaymentDeadline] - ISO date string
 * @param {string} reason - Admin must provide a reason
 * @param {string} adminId
 * @returns {Promise<RoomHold>}
 */
const extendDeadline = async (holdId, { newRefundDeadline, newPaymentDeadline }, reason, adminId) => {
  if (!newRefundDeadline && !newPaymentDeadline) {
    const err = new Error('At least one deadline must be provided.');
    err.statusCode = 400;
    throw err;
  }
  if (!reason || String(reason).trim().length < 5) {
    const err = new Error('A reason for the extension is required (min 5 chars).');
    err.statusCode = 400;
    throw err;
  }

  const hold = await RoomHold.findById(holdId);
  if (!hold) {
    const err = new Error('Room hold not found.');
    err.statusCode = 404;
    throw err;
  }
  if (hold.status !== 'active') {
    const err = new Error(`Cannot extend deadlines on a hold with status '${hold.status}'.`);
    err.statusCode = 400;
    throw err;
  }

  const prev = {
    refundDeadline:  hold.refundDeadline,
    paymentDeadline: hold.paymentDeadline,
  };

  if (newRefundDeadline)  hold.refundDeadline  = new Date(newRefundDeadline);
  if (newPaymentDeadline) hold.paymentDeadline = new Date(newPaymentDeadline);
  await hold.save();

  auditLog('DEADLINE_EXTENDED', {
    holdId: hold._id,
    userId: hold.userId,
    adminId,
    reason,
    previous: prev,
    updated: {
      refundDeadline:  hold.refundDeadline,
      paymentDeadline: hold.paymentDeadline,
    },
  });

  return hold;
};

// ── forceExpire ───────────────────────────────────────────────────────────────

/**
 * Admin force-expires an active hold. Room seat is released.
 *
 * @param {string} holdId
 * @param {string} reason
 * @param {string} adminId
 * @returns {Promise<RoomHold>}
 */
const forceExpire = async (holdId, reason, adminId) => {
  if (!reason || String(reason).trim().length < 5) {
    const err = new Error('A reason is required for force expiry (min 5 chars).');
    err.statusCode = 400;
    throw err;
  }

  const hold = await RoomHold.findById(holdId);
  if (!hold) {
    const err = new Error('Room hold not found.');
    err.statusCode = 404;
    throw err;
  }
  if (!['pending_approval', 'active'].includes(hold.status)) {
    const err = new Error(`Cannot expire a hold with status '${hold.status}'.`);
    err.statusCode = 400;
    throw err;
  }

  const wasActive = hold.status === 'active';
  hold.status    = 'expired';
  hold.expiredAt = new Date();
  await hold.save();

  // Release seat only if hold was active (seat was already reserved)
  if (wasActive) {
    await RoomType.findByIdAndUpdate(hold.roomTypeId, {
      $inc: { bookedSeats: -1 },
    });
  }

  auditLog('HOLD_FORCE_EXPIRED', {
    holdId: hold._id,
    userId: hold.userId,
    adminId,
    reason,
    previousStatus: wasActive ? 'active' : 'pending_approval',
  });

  return hold;
};

// ── getDepositFinancialSummary ────────────────────────────────────────────────

/**
 * Enhanced financial summary for the deposit dashboard.
 */
const getDepositFinancialSummary = async () => {
  const [pipeline] = await RoomHold.aggregate([
    {
      $group: {
        _id: null,
        pending:          { $sum: { $cond: [{ $eq: ['$status', 'pending_approval'] }, 1, 0] } },
        active:           { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        converted:        { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
        refunded:         { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] } },
        expired:          { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } },
        totalDepositsHeld:    { $sum: { $cond: [{ $eq: ['$status', 'active'] }, '$depositAmount', 0] } },
        totalRefundedAmount:  { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, '$depositAmount', 0] } },
        totalConvertedAmount: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, '$depositAmount', 0] } },
        totalAdvanceCollected: { $sum: { $cond: [{ $in: ['$status', ['active', 'converted']] }, '$advanceAmount', 0] } },
      },
    },
  ]);

  return pipeline || {
    pending: 0, active: 0, converted: 0, refunded: 0, expired: 0,
    totalDepositsHeld: 0, totalRefundedAmount: 0, totalConvertedAmount: 0, totalAdvanceCollected: 0,
  };
};

module.exports = {
  initiateDeposit,
  approveDeposit,
  requestRefund,
  approveRefund,
  rejectRefund,
  getDepositCredit,
  markHoldConverted,
  expireOverdueHolds,
  getHoldStatus,
  getDepositOnlyStatus,
  adminCreateDeposit,
  extendDeadline,
  forceExpire,
  getDepositFinancialSummary,
};
