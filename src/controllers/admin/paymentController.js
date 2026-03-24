const paymentService = require('../../services/paymentService');
const User = require('../../models/User');
const { success, error } = require('../../utils/apiResponse');
const { emitToAdmins, emitToUser } = require('../../services/socketService');

const getPayments = async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const result = await paymentService.getPayments({ page, limit, status });
    return success(res, result, 'Payments fetched successfully');
  } catch (err) {
    next(err);
  }
};

const getPaymentStats = async (req, res, next) => {
  try {
    const stats = await paymentService.getPaymentStats();
    return success(res, stats, 'Payment statistics fetched successfully');
  } catch (err) {
    next(err);
  }
};

const getPaymentById = async (req, res, next) => {
  try {
    const payment = await paymentService.getPaymentById(req.params.id);
    return success(res, payment, 'Payment fetched successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

const createPayment = async (req, res, next) => {
  try {
    const payment = await paymentService.createPayment(req.body);
    return success(res, payment, 'Payment created successfully', 201);
  } catch (err) {
    next(err);
  }
};

const approvePayment = async (req, res, next) => {
  try {
    const payment = await paymentService.approvePayment(req.params.id, req.user._id);
    // Sync paymentStatus to User model
    const userId = payment.userId._id || payment.userId;
    await User.findByIdAndUpdate(userId, { paymentStatus: 'approved' });
    const updatedUser = await User.findById(userId);
    emitToUser(userId.toString(), 'payment:updated', payment);
    emitToUser(userId.toString(), 'user:updated', updatedUser);
    emitToAdmins('payment:updated', payment);
    emitToAdmins('user:updated', updatedUser);
    return success(res, payment, 'Payment approved successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

const rejectPayment = async (req, res, next) => {
  try {
    const { remarks } = req.body;
    const payment = await paymentService.rejectPayment(req.params.id, remarks);
    // Sync paymentStatus to User model
    const userId = payment.userId._id || payment.userId;
    await User.findByIdAndUpdate(userId, { paymentStatus: 'rejected' });
    const updatedUser = await User.findById(userId);
    emitToUser(userId.toString(), 'payment:updated', payment);
    emitToUser(userId.toString(), 'user:updated', updatedUser);
    emitToAdmins('payment:updated', payment);
    emitToAdmins('user:updated', updatedUser);
    return success(res, payment, 'Payment rejected successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

const attachReceipt = async (req, res, next) => {
  try {
    const { receiptUrl } = req.body;
    const payment = await paymentService.attachReceipt(req.params.id, receiptUrl);
    return success(res, payment, 'Receipt attached successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
};

const exportPayments = async (req, res, next) => {
  try {
    const { status, startDate, endDate } = req.query;
    const payments = await paymentService.exportPayments({ status, startDate, endDate });
    return success(res, {
      payments,
      exportedAt: new Date().toISOString(),
      count: payments.length,
    }, 'Payments exported');
  } catch (err) {
    next(err);
  }
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
