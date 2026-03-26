'use strict';

const Payment        = require('../models/Payment');
const Transaction    = require('../models/Transaction');
const User           = require('../models/User');
const pricingService = require('./pricingService');
const depositService = require('./depositService');
const { emitToAdmins, emitToUser } = require('./socketService');

// ── Get Payments (admin listing) ───────────────────────────────────────────────

/**
 * @param {{ page?: number, limit?: number, status?: string }} opts
 */
const getPayments = async ({ page = 1, limit = 10, status } = {}) => {
  const query = {};
  if (status) query.status = status;

  const skip = (page - 1) * limit;

  const [payments, total] = await Promise.all([
    Payment.find(query)
      .populate('userId', 'userId name email phone roomNumber roomType onboardingStatus referralCode')
      .populate('approvedBy', 'userId name')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip, 10))
      .limit(parseInt(limit, 10)),
    Payment.countDocuments(query),
  ]);

  return {
    payments,
    pagination: {
      page:  parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

// ── Payment Stats (admin) ─────────────────────────────────────────────────────

const getPaymentStats = async () => {
  const [totalResult, byStatus, recentPayments] = await Promise.all([
    Payment.aggregate([
      { $match: { status: { $ne: 'upcoming' } } }, // exclude upcoming from totals
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
    ]),
    Payment.find({ status: { $ne: 'upcoming' } })
      .populate('userId', 'userId name email phone roomNumber roomType onboardingStatus')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('paymentId amount status paymentMethod createdAt installmentNumber paymentMode'),
  ]);

  const statusStats = {};
  byStatus.forEach((s) => {
    statusStats[s._id] = { count: s.count, totalAmount: s.totalAmount };
  });

  return {
    total:       totalResult[0]?.count      || 0,
    pending:     statusStats.pending?.count  || 0,
    approved:    statusStats.approved?.count || 0,
    rejected:    statusStats.rejected?.count || 0,
    upcoming:    statusStats.upcoming?.count || 0,
    totalAmount: totalResult[0]?.totalAmount || 0,
    byStatus:    statusStats,
    recentPayments,
  };
};

// ── Get Single Payment ─────────────────────────────────────────────────────────

/** @param {string} id */
const getPaymentById = async (id) => {
  const payment = await Payment.findById(id)
    .populate('userId', 'userId name email phone roomNumber roomType onboardingStatus referralCode')
    .populate('approvedBy', 'userId name');

  if (!payment) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }

  return payment;
};

// ── Create Payment (admin manual creation) ───────────────────────────────────

const createPayment = async (data) => {
  const payment = await Payment.create(data);
  return payment;
};

// ── Initiate Payment (resident) ───────────────────────────────────────────────

/**
 * Full payment initiation flow.
 * - Calls pricingService.calculatePayment (server-side amount only).
 * - Creates Payment doc(s) with immutable breakdown.
 * - Creates Transaction record.
 * - Pre-creates installment 2 Payment with status 'upcoming' for half-pay.
 * - Applies referral credit to referrer.
 * - Syncs User.paymentStatus and add-on preferences.
 *
 * @param {string} userId - MongoDB ObjectId string of the paying resident
 * @param {Object} opts
 * @param {string}  opts.paymentMode   - 'full' | 'half'
 * @param {Object}  opts.addOns        - { transport, mess, messLumpSum }
 * @param {string|null} opts.referralCode
 * @param {string}  opts.paymentMethod
 * @param {string}  opts.transactionId
 * @param {string}  opts.receiptUrl
 * @param {string}  opts.description
 * @returns {Promise<{ payment: Object, payment2: Object|null, breakdown: Object }>}
 */
const initiatePayment = async (
  userId,
  { paymentMode, addOns = {}, referralCode = null, paymentMethod, transactionId, receiptUrl, description }
) => {
  const user = await User.findById(userId).populate('roomTypeId');
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  if (!user.roomTypeId) {
    const err = new Error('User has no room type assigned. Cannot initiate payment.');
    err.statusCode = 422;
    throw err;
  }

  // Check for existing pending payment — prevent duplicates
  const existingPending = await Payment.findOne({ userId, status: 'pending' });
  if (existingPending) {
    const err = new Error('A pending payment already exists. Please wait for admin verification.');
    err.statusCode = 409;
    throw err;
  }

  // Check for an existing upcoming installment 2 collision
  const existing = await Payment.findOne({ userId, installmentNumber: 1, status: { $in: ['pending', 'approved'] } });
  if (existing) {
    const err = new Error('A payment has already been initiated or approved. Contact admin to proceed.');
    err.statusCode = 409;
    throw err;
  }

  // Validate transactionId uniqueness
  if (transactionId && transactionId.trim()) {
    const dupTxn = await Payment.findOne({ transactionId: transactionId.trim() });
    if (dupTxn) {
      const err = new Error('A payment with this transaction ID already exists.');
      err.statusCode = 409;
      throw err;
    }
  }

  // ── Server-side calculation (frontend amount is IGNORED) ──────────────────
  // First, check for an active deposit already paid — credit it against installment 1
  const depositInfo = await depositService.getDepositCredit(userId.toString());

  const calc = await pricingService.calculatePayment({
    roomTypeId:    user.roomTypeId._id || user.roomTypeId,
    paymentMode,
    addOns,
    referralCode,
    currentUserId: userId,
    depositCredit: depositInfo.creditAmount, // 0 if no active hold
  });

  const { breakdown, breakdown2, installment1, installment2, referrer, config } = calc;
  const onboardingDate  = new Date();
  const schedule        = pricingService.getInstallmentSchedule(paymentMode, onboardingDate, installment1, installment2);

  // ── Audit log (structured JSON for traceability) ──────────────────────────
  console.info(
    JSON.stringify({
      event:     'PAYMENT_INITIATION',
      userId,
      paymentMode,
      addOns,
      referralCode: !!referralCode,
      depositCredit: depositInfo.creditAmount,
      breakdown,
      installment1,
      installment2,
      timestamp: onboardingDate.toISOString(),
    })
  );

  // ── Create installment 1 Payment ──────────────────────────────────────────
  const inst1Desc = description || `Onboarding Payment — Installment 1 (${paymentMode === 'full' ? 'Full Tenure' : 'Half Pay: months 1-6'})`;

  const payment = await Payment.create({
    userId,
    amount:            installment1,
    paymentMode,
    installmentNumber: 1,
    dueDate:           schedule[0].dueDate,
    paymentMethod:     paymentMethod || '',
    description:       inst1Desc,
    transactionId:     transactionId || '',
    receiptUrl:        receiptUrl   || '',
    status:            'pending',
    depositCredited:   depositInfo.creditAmount,
    breakdown,
  });

  // ── Create installment 1 Transaction ─────────────────────────────────────
  await Transaction.create({
    paymentId:         payment._id,
    userId,
    type:              'credit',
    amount:            installment1,
    category:          'payment',
    description:       inst1Desc,
    status:            'pending',
    installmentNumber: 1,
    breakdown: {
      roomRentTotal:     breakdown.roomRentTotal,
      registrationFee:   breakdown.registrationFee,
      securityDeposit:   breakdown.securityDeposit,
      transportTotal:    breakdown.transportTotal,
      messTotal:         breakdown.messTotal,
      discountRate:      breakdown.discountRate,
      gstRate:           breakdown.gstRate,
      referralDeduction: breakdown.referralDeduction,
      finalAmount:       breakdown.finalAmount,
    },
  });

  // ── Pre-create installment 2 (upcoming) for half-pay ─────────────────────
  let payment2 = null;
  if (paymentMode === 'half' && installment2 > 0 && breakdown2 && schedule[1]) {
    const inst2Desc = `Onboarding Payment — Installment 2 (Half Pay: months 7-11)`;

    payment2 = await Payment.create({
      userId,
      amount:            installment2,
      paymentMode,
      installmentNumber: 2,
      dueDate:           schedule[1].dueDate,
      paymentMethod:     paymentMethod || '',
      description:       inst2Desc,
      transactionId:     '',      // Filled when resident submits this installment
      receiptUrl:        '',
      status:            'upcoming',
      breakdown:         breakdown2,
    });
    // TODO: Add a cron/scheduled job to change status from 'upcoming' → 'due'
    //       when Date.now() >= payment2.dueDate. This is flagged for future implementation.
  }

  // ── Sync User record ───────────────────────────────────────────────────────
  const tenureStartDate = onboardingDate;
  const tenureEndDate   = new Date(onboardingDate);
  tenureEndDate.setMonth(tenureEndDate.getMonth() + config.tenureMonths);

  await User.findByIdAndUpdate(userId, {
    paymentStatus:    'pending',
    paymentMode,
    selectedAddOns:   { transport: !!addOns.transport, mess: !!addOns.mess, messLumpSum: !!addOns.messLumpSum },
    tenureStartDate,
    tenureEndDate,
    ...(referralCode ? { referredBy: referralCode.toUpperCase() } : {}),
  });

  // ── Apply referral credit to referrer ─────────────────────────────────────
  if (referrer) {
    const cfg = await pricingService.getPricingConfig();
    await pricingService.applyReferralCredit(referrer._id.toString(), cfg.referralBonus);
  }

  // ── Mark RoomHold as converted (if deposit was credited) ──────────────────
  if (depositInfo.hasDeposit && depositInfo.holdId) {
    await depositService.markHoldConverted(userId.toString(), payment._id);
  }

  // ── Real-time events ───────────────────────────────────────────────────────
  const updatedUser = await User.findById(userId);
  emitToAdmins('payment:new', payment);
  emitToAdmins('user:updated', updatedUser);
  emitToUser(userId.toString(), 'user:updated', updatedUser);

  return { payment, payment2, breakdown };
};

// ── Approve Payment (admin) ───────────────────────────────────────────────────

/**
 * @param {string} id             - Payment MongoDB ObjectId
 * @param {string} approvedByUserId - Admin user's ObjectId
 */
const approvePayment = async (id, approvedByUserId) => {
  const payment = await Payment.findById(id);

  if (!payment) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }

  if (payment.status !== 'pending') {
    const err = new Error(`Cannot approve a payment with status '${payment.status}'`);
    err.statusCode = 400;
    throw err;
  }

  payment.status     = 'approved';
  payment.approvedBy = approvedByUserId;
  await payment.save();

  // Audit log
  console.info(
    JSON.stringify({
      event:     'PAYMENT_APPROVED',
      paymentId: payment._id,
      userId:    payment.userId,
      amount:    payment.amount,
      approvedBy: approvedByUserId,
      breakdown: payment.breakdown || null,
      timestamp: new Date().toISOString(),
    })
  );

  return payment;
};

// ── Reject Payment (admin) ────────────────────────────────────────────────────

const rejectPayment = async (id, remarks) => {
  const payment = await Payment.findById(id);

  if (!payment) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }

  if (payment.status === 'approved') {
    const err = new Error('Cannot reject an already approved payment');
    err.statusCode = 400;
    throw err;
  }

  payment.status  = 'rejected';
  payment.remarks = remarks || '';
  await payment.save();

  await payment.populate('userId', 'userId name email');
  return payment;
};

// ── Attach Receipt ─────────────────────────────────────────────────────────────

const attachReceipt = async (id, receiptUrl) => {
  const payment = await Payment.findById(id);
  if (!payment) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }
  payment.receiptUrl = receiptUrl;
  await payment.save();
  return payment;
};

// ── Export Payments ────────────────────────────────────────────────────────────

const exportPayments = async ({ status, startDate, endDate } = {}) => {
  const query = {};
  if (status) query.status = status;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate)   query.createdAt.$lte = new Date(endDate);
  }

  return Payment.find(query)
    .populate('userId', 'userId name email phone roomNumber roomType')
    .populate('approvedBy', 'userId name')
    .sort({ createdAt: -1 })
    .lean();
};

// ── Get Upcoming Installments (resident) ───────────────────────────────────────

const getUpcomingInstallments = async (userId) => {
  return pricingService.getUpcomingInstallments(userId);
};

// ── Payment Analytics (admin) ─────────────────────────────────────────────────

/**
 * Returns aggregate analytics for the admin dashboard.
 * @returns {Promise<Object>}
 */
const getPaymentAnalytics = async () => {
  const [collected, pending, upcoming, referralStats] = await Promise.all([
    // Total collected (approved payments only, excl. upcoming pre-created)
    Payment.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    // Pending payments
    Payment.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    // Upcoming (pre-created installment 2 records)
    Payment.aggregate([
      { $match: { status: 'upcoming' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    // Total referral credits issued (sum of all users' referralCredit)
    require('../models/User').aggregate([
      { $group: { _id: null, totalCreditsIssued: { $sum: '$referralCredit' }, usersWithCredit: { $sum: { $cond: [{ $gt: ['$referralCredit', 0] }, 1, 0] } } } },
    ]),
  ]);

  return {
    totalCollected:   collected[0]?.total  || 0,
    collectedCount:   collected[0]?.count  || 0,
    pendingTotal:     pending[0]?.total    || 0,
    pendingCount:     pending[0]?.count    || 0,
    upcomingTotal:    upcoming[0]?.total   || 0,
    upcomingCount:    upcoming[0]?.count   || 0,
    referralCreditsIssued: referralStats[0]?.totalCreditsIssued || 0,
    usersWithReferralCredit: referralStats[0]?.usersWithCredit  || 0,
  };
};

module.exports = {
  getPayments,
  getPaymentStats,
  getPaymentById,
  createPayment,
  initiatePayment,
  approvePayment,
  rejectPayment,
  attachReceipt,
  exportPayments,
  getUpcomingInstallments,
  getPaymentAnalytics,
};
