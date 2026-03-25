const Payment = require('../../models/Payment');
const Transaction = require('../../models/Transaction');
const User = require('../../models/User');
const Room = require('../../models/Room');
const { success, error } = require('../../utils/apiResponse');
const { emitToAdmins, emitToUser } = require('../../services/socketService');

// Add-on prices (server-side source of truth)
const ADD_ON_PRICES = {
  transport: 2500,
  lunch: 1500,
};

/**
 * POST /api/public/payments/initiate
 * Resident creates a payment record (e.g., after uploading receipt or completing gateway checkout)
 * Status starts as "pending" — admin verifies and approves later.
 */
const initiatePayment = async (req, res, next) => {
  try {
    const { amount, paymentMethod, description, transactionId, receiptUrl } = req.body;

    const user = await User.findById(req.user._id).populate('selectedRoom');
    if (!user) return error(res, 'User not found', 404);

    // Validate amount against backend room pricing (prevent frontend manipulation)
    if (user.selectedRoom) {
      const roomPrice = user.selectedRoom.pricePerMonth || 0;
      // Calculate expected add-on cost from messPackage
      let expectedAddOns = 0;
      if (user.messPackage === 'full-board') expectedAddOns += ADD_ON_PRICES.lunch;
      // Transport is optional — allow the amount to be roomPrice + any combination of add-ons
      const minExpected = roomPrice;
      const maxExpected = roomPrice + ADD_ON_PRICES.transport + ADD_ON_PRICES.lunch;

      if (amount < minExpected || amount > maxExpected) {
        return error(res, `Invalid payment amount. Expected between ₹${minExpected} and ₹${maxExpected}`, 400);
      }
    }

    // Reject duplicate transactionId
    if (transactionId && transactionId.trim()) {
      const existing = await Payment.findOne({ transactionId: transactionId.trim() });
      if (existing) {
        return error(res, 'A payment with this transaction ID already exists', 409);
      }
    }

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
