const Payment = require('../models/Payment');

const getPayments = async ({ page = 1, limit = 10, status }) => {
  const query = {};
  if (status) query.status = status;

  const skip = (page - 1) * limit;

  const [payments, total] = await Promise.all([
    Payment.find(query)
      .populate('userId', 'userId name email phone roomNumber roomType onboardingStatus')
      .populate('approvedBy', 'userId name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10)),
    Payment.countDocuments(query),
  ]);

  return {
    payments,
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

const getPaymentStats = async () => {
  const [totalResult, byStatus, recentPayments] = await Promise.all([
    Payment.aggregate([
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
    ]),
    Payment.find()
      .populate('userId', 'userId name email phone roomNumber roomType onboardingStatus')
      .sort({ createdAt: -1 })
      .limit(5)
      .select('paymentId amount status paymentMethod createdAt'),
  ]);

  const statusStats = {};
  byStatus.forEach((s) => {
    statusStats[s._id] = { count: s.count, totalAmount: s.totalAmount };
  });

  return {
    totalAmount: totalResult[0]?.totalAmount || 0,
    totalCount: totalResult[0]?.count || 0,
    byStatus: statusStats,
    recentPayments,
  };
};

const getPaymentById = async (id) => {
  const payment = await Payment.findById(id)
    .populate('userId', 'userId name email phone roomNumber roomType onboardingStatus')
    .populate('approvedBy', 'userId name');

  if (!payment) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }

  return payment;
};

const createPayment = async (data) => {
  const payment = await Payment.create(data);
  return payment;
};

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

  payment.status = 'approved';
  payment.approvedBy = approvedByUserId;
  await payment.save();

  return payment;
};

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

  payment.status = 'rejected';
  payment.remarks = remarks || '';
  await payment.save();

  return payment;
};

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

const exportPayments = async ({ status, startDate, endDate }) => {
  const query = {};
  if (status) query.status = status;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  return Payment.find(query)
    .populate('userId', 'userId name email phone roomNumber roomType')
    .populate('approvedBy', 'userId name')
    .sort({ createdAt: -1 })
    .lean();
};

module.exports = {
  getPayments,
  getPaymentStats,
  getPaymentById,
  createPayment,
  approvePayment,
  rejectPayment,
  attachReceipt,
  exportPayments,
};
