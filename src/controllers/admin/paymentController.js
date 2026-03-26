'use strict';

const paymentService  = require('../../services/paymentService');
const User            = require('../../models/User');
const RoomType        = require('../../models/RoomType');
const { success, error } = require('../../utils/apiResponse');
const { emitToAdmins, emitToUser } = require('../../services/socketService');

// ── Get Payments (listing with filters) ───────────────────────────────────────

/**
 * GET /api/admin/payments
 * @route GET /api/admin/payments
 * @access Admin, Accountant
 */
const getPayments = async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const result = await paymentService.getPayments({ page, limit, status });
    return success(res, result, 'Payments fetched successfully');
  } catch (err) {
    next(err);
  }
};

// ── Get Payment Stats ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/payments/stats
 * @route GET /api/admin/payments/stats
 * @access Admin, Accountant
 */
const getPaymentStats = async (req, res, next) => {
  try {
    const stats = await paymentService.getPaymentStats();
    return success(res, stats, 'Payment statistics fetched successfully');
  } catch (err) {
    next(err);
  }
};

// ── Get Payment Analytics ─────────────────────────────────────────────────────

/**
 * GET /api/admin/payments/analytics
 * Returns aggregate analytics: collected, pending, upcoming, referral credits.
 *
 * @route GET /api/admin/payments/analytics
 * @access Admin, Accountant
 */
const getPaymentAnalytics = async (req, res, next) => {
  try {
    const analytics = await paymentService.getPaymentAnalytics();
    return success(res, analytics, 'Payment analytics fetched successfully');
  } catch (err) {
    next(err);
  }
};

// ── Get Payment By ID ──────────────────────────────────────────────────────────

/**
 * GET /api/admin/payments/:id
 * @route GET /api/admin/payments/:id
 * @access Admin, Accountant
 */
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

// ── Create Payment (admin manual creation) ─────────────────────────────────────

/**
 * POST /api/admin/payments
 * Admin can manually create a payment record (e.g., for offline cash payments).
 *
 * @route POST /api/admin/payments
 * @access Admin
 */
const createPayment = async (req, res, next) => {
  try {
    const payment = await paymentService.createPayment(req.body);
    return success(res, payment, 'Payment created successfully', 201);
  } catch (err) {
    next(err);
  }
};

// ── Approve Payment ────────────────────────────────────────────────────────────

/**
 * PATCH /api/admin/payments/:id/approve
 * Approves a pending payment and syncs User.paymentStatus.
 *
 * @route PATCH /api/admin/payments/:id/approve
 * @access Admin
 */
const approvePayment = async (req, res, next) => {
  try {
    const payment = await paymentService.approvePayment(req.params.id, req.user._id);

    // Sync paymentStatus to User model
    const userId = payment.userId?._id || payment.userId;
    await User.findByIdAndUpdate(userId, { paymentStatus: 'approved' });
    const updatedUser = await User.findById(userId);

    // Audit log
    console.info(
      JSON.stringify({
        event:      'ADMIN_PAYMENT_APPROVED',
        paymentId:  payment._id,
        userId,
        amount:     payment.amount,
        installmentNumber: payment.installmentNumber,
        approvedBy: req.user._id,
        breakdown:  payment.breakdown || null,
        timestamp:  new Date().toISOString(),
      })
    );

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

// ── Reject Payment ─────────────────────────────────────────────────────────────

/**
 * PATCH /api/admin/payments/:id/reject
 * Rejects a pending payment, resets the user's room booking state, and
 * decrements room occupancy.
 *
 * @route PATCH /api/admin/payments/:id/reject
 * @access Admin
 */
const rejectPayment = async (req, res, next) => {
  try {
    const { remarks } = req.body;
    const payment = await paymentService.rejectPayment(req.params.id, remarks);

    const userId = payment.userId?._id || payment.userId;
    await User.findByIdAndUpdate(userId, { paymentStatus: 'rejected' });

    // Release room hold and decrement occupancy on rejection
    const rejectedUser = await User.findById(userId);
    if (rejectedUser?.roomTypeId) {
      const roomTypeObj = await RoomType.findById(rejectedUser.roomTypeId);
      if (roomTypeObj) {
        if (roomTypeObj.bookedSeats > 0) roomTypeObj.bookedSeats -= 1;
        await roomTypeObj.save();
      }
      // Reset user's room booking state
      rejectedUser.roomTypeId  = null;
      rejectedUser.roomNumber  = '';
      rejectedUser.roomType    = '';
      rejectedUser.paymentMode = null;
      await rejectedUser.save();
    }

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

// ── Attach Receipt ─────────────────────────────────────────────────────────────

/**
 * PATCH /api/admin/payments/:id/receipt
 * @route PATCH /api/admin/payments/:id/receipt
 * @access Admin, Accountant
 */
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

// ── Export Payments ────────────────────────────────────────────────────────────

/**
 * GET /api/admin/payments/export/data
 * @route GET /api/admin/payments/export/data
 * @access Admin, Accountant
 */
const exportPayments = async (req, res, next) => {
  try {
    const { status, startDate, endDate } = req.query;
    const payments = await paymentService.exportPayments({ status, startDate, endDate });
    return success(res, {
      payments,
      exportedAt: new Date().toISOString(),
      count:      payments.length,
    }, 'Payments exported');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPayments,
  getPaymentStats,
  getPaymentAnalytics,
  getPaymentById,
  createPayment,
  approvePayment,
  rejectPayment,
  attachReceipt,
  exportPayments,
};
