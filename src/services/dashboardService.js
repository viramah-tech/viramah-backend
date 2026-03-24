const User = require('../models/User');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');

const getOverview = async () => {
  const [
    totalUsers,
    activeUsers,
    totalPayments,
    pendingPayments,
    revenueResult,
    recentUsers,
    recentPayments,
    onboardingAgg,
    roomOccupancyAgg,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ status: 'active' }),
    Payment.countDocuments(),
    Payment.countDocuments({ status: 'pending' }),
    Payment.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('userId name role status createdAt'),
    Payment.find()
      .populate('userId', 'userId name')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('paymentId amount status createdAt'),
    User.aggregate([
      { $group: { _id: '$onboardingStatus', count: { $sum: 1 } } },
    ]),
    User.aggregate([
      { $match: { roomType: { $ne: '', $exists: true } } },
      { $group: { _id: '$roomType', count: { $sum: 1 } } },
    ]),
  ]);

  // Build onboarding stats
  const onboardingStats = {
    pending: 0,
    'in-progress': 0,
    completed: 0,
    rejected: 0,
  };
  onboardingAgg.forEach((item) => {
    if (item._id && onboardingStats.hasOwnProperty(item._id)) {
      onboardingStats[item._id] = item.count;
    }
  });

  // Build room occupancy stats
  const roomOccupancy = {
    'VIRAMAH Nexus': 0,
    'VIRAMAH Axis': 0,
    'VIRAMAH Collective': 0,
    'VIRAMAH Axis+': 0,
    totalOccupied: 0,
  };
  roomOccupancyAgg.forEach((item) => {
    if (item._id && roomOccupancy.hasOwnProperty(item._id)) {
      roomOccupancy[item._id] = item.count;
    }
    roomOccupancy.totalOccupied += item.count;
  });

  return {
    totalUsers,
    activeUsers,
    totalPayments,
    pendingPayments,
    totalRevenue: revenueResult[0]?.total || 0,
    recentActivity: {
      users: recentUsers,
      payments: recentPayments,
    },
    onboardingStats,
    roomOccupancy,
  };
};

const getFinancialSummary = async () => {
  const [creditResult, debitResult, monthlyBreakdown] = await Promise.all([
    Transaction.aggregate([
      { $match: { type: 'credit', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      { $match: { type: 'debit', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          totalCredits: {
            $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] },
          },
          totalDebits: {
            $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
    ]),
  ]);

  const totalCredits = creditResult[0]?.total || 0;
  const totalDebits = debitResult[0]?.total || 0;

  return {
    totalCredits,
    totalDebits,
    netBalance: totalCredits - totalDebits,
    monthlyBreakdown,
  };
};

const getRecentActivity = async () => {
  const [recentUsers, recentPayments, recentTransactions] = await Promise.all([
    User.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('userId name role status createdAt'),
    Payment.find()
      .populate('userId', 'userId name')
      .sort({ createdAt: -1 })
      .limit(10)
      .select('paymentId amount status paymentMethod createdAt'),
    Transaction.find()
      .populate('userId', 'userId name')
      .sort({ createdAt: -1 })
      .limit(10)
      .select('transactionId type amount category status createdAt'),
  ]);

  return {
    recentUsers,
    recentPayments,
    recentTransactions,
  };
};

module.exports = { getOverview, getFinancialSummary, getRecentActivity };
