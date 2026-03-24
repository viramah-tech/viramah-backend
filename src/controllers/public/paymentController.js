const Payment = require('../../models/Payment');
const Transaction = require('../../models/Transaction');
const User = require('../../models/User');
const { success, error } = require('../../utils/apiResponse');
const { emitToAdmins, emitToUser } = require('../../services/socketService');

/**
 * POST /api/public/payments/initiate
 * Resident creates a payment record (e.g., after uploading receipt or completing gateway checkout)
 * Status starts as "pending" — admin verifies and approves later.
 */
const initiatePayment = async (req, res, next) => {
  try {
    const { amount, paymentMethod, description, transactionId, receiptUrl } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return error(res, 'User not found', 404);

    const payment = await Payment.create({
      userId: user._id,
      amount,
      paymentMethod: paymentMethod || '',
      description: description || '',
      transactionId: transactionId || '',
      receiptUrl: receiptUrl || '',
      status: 'pending',
    });

    // Create a pending transaction record
    await Transaction.create({
      paymentId: payment._id,
      userId: user._id,
      type: 'credit',
      amount,
      category: 'payment',
      description: description || `Payment ${payment.paymentId}`,
      status: 'pending',
    });

    // Sync paymentStatus to User model
    await User.findByIdAndUpdate(user._id, { paymentStatus: 'pending' });
    const updatedUser = await User.findById(user._id);

    // Emit real-time events
    emitToAdmins('payment:new', payment);
    emitToAdmins('user:updated', updatedUser);
    emitToUser(user._id.toString(), 'user:updated', updatedUser);

    return success(
      res,
      { payment },
      'Payment submitted — awaiting verification',
      201
    );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/public/payments/my-payments
 * List all payments for the logged-in resident
 */
const getMyPayments = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [payments, total] = await Promise.all([
      Payment.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Payment.countDocuments({ userId: req.user._id }),
    ]);

    return success(res, {
      payments,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    }, 'Payments fetched');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/public/payments/:id
 * Get a single payment detail (only if it belongs to the logged-in resident)
 */
const getPaymentById = async (req, res, next) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!payment) return error(res, 'Payment not found', 404);

    return success(res, { payment }, 'Payment fetched');
  } catch (err) {
    next(err);
  }
};

module.exports = { initiatePayment, getMyPayments, getPaymentById };
