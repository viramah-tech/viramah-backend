'use strict';

// V1 read-only service. Write helpers (createPayment / initiatePayment /
// approvePayment / rejectPayment / attachReceipt) were removed — see V2:
//   - paymentReviewService (admin approve / reject / hold / manual)
//   - paymentSubmitService (resident submit)

const Payment        = require('../models/Payment');
const pricingService = require('./pricing-service');

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
  exportPayments,
  getUpcomingInstallments,
  getPaymentAnalytics,
};
