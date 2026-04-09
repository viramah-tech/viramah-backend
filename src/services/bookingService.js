'use strict';

/**
 * bookingService.js — Entry point for new Booking-first flow.
 */

const Booking = require('../models/Booking');
const User = require('../models/User');
const RoomType = require('../models/RoomType');
const Payment = require('../models/Payment');
const { getPricingConfig } = require('./pricingService');
const { startPriceLock, startPaymentWindow, getTimerStatus } = require('./timerService');
const { processOcr, checkDuplicateUtr } = require('./paymentVerificationService');
const { emitToAdmins, emitToUser } = require('./socketService');
const { generateId } = require('../utils/ulid');

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * Generate BK ID
 */
const generateBookingId = () => {
  const year = new Date().getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `BK-${year}-${rand}`;
};

/**
 * Step 1: Resident initiates booking.
 */
async function initiateBooking(userId, { roomTypeId, addOns = {} }) {
  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);

  // Check if they already have an active booking
  const existing = await Booking.findOne({
    userId,
    status: { $in: ['DRAFT', 'PENDING_BOOKING_PAYMENT', 'UNDER_VERIFICATION', 'BOOKING_CONFIRMED', 'FINAL_PAYMENT_PENDING'] }
  });
  if (existing) {
    throw err('You already have an active booking', 409);
  }

  const roomType = await RoomType.findById(roomTypeId);
  if (!roomType) throw err('Room type not found', 404);

  const cfg = await getPricingConfig();
  const totalBookingAmount = 1618000; // paise (₹16,180) -> Config driven in real scenario based on PricingConfig

  const booking = await Booking.create({
    bookingId: generateBookingId(),
    userId,
    selections: {
      roomType: roomType.name,
      roomTypeId: roomType._id,
      tenure: 11,
      mess: { selected: !!addOns.mess, amount: 0 },
      transport: { selected: !!addOns.transport, amount: 0 }
    },
    financials: {
      securityDeposit: 1500000,
      registrationFee: 100000,
      registrationGst: 18000,
      totalBookingAmount: totalBookingAmount,
      totalPaid: 0,
      precision: 'paise'
    },
    status: 'PENDING_BOOKING_PAYMENT'
  });

  // Start 15 min price lock
  await startPriceLock(booking._id, cfg.timers?.priceLockMinutes || 15);

  user.roomTypeId = roomType._id;
  user.paymentProfile = user.paymentProfile || {};
  user.paymentProfile.currentBookingId = booking._id;
  user.paymentProfile.paymentStatus = 'BOOKING_PENDING';
  await user.save();

  return booking;
}

/**
 * Step 2: Resident submits booking payment proof.
 */
async function submitBookingPayment(userId, bookingId, { transactionId, receiptUrl, paymentMethod, amount }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);
  if (String(booking.userId) !== String(userId)) throw err('Forbidden', 403);
  if (booking.status !== 'PENDING_BOOKING_PAYMENT') throw err('Invalid generic booking status', 400);

  // Cancel price lock explicitly since they initiated payment
  const { cancelTimer } = require('./timerService');
  await cancelTimer(booking._id, 'price-lock');

  // Verify amount matches exactly ₹16,180 (1618000 paise). The amount passed here must be in paise or assumed matching frontend logic.
  const submitAmountPaise = Number(amount) < 50000 ? Math.round(Number(amount) * 100) : Number(amount); 
  if (submitAmountPaise !== booking.financials.totalBookingAmount) {
     throw err(`Booking amount must be exactly exactly ₹${(booking.financials.totalBookingAmount / 100).toLocaleString()}`, 400);
  }

  // Duplicate Check
  const dedup = await checkDuplicateUtr(transactionId, submitAmountPaise, new Date().toISOString());

  const payment = await Payment.create({
    userId,
    bookingId: booking._id,
    paymentType: 'BOOKING',
    type: 'BOOKING',
    category: 'SECURITY_DEPOSIT', // Simplification for classification
    amount: submitAmountPaise,
    transactionId: String(transactionId).trim(),
    receiptUrl: String(receiptUrl).trim(),
    paymentMethod,
    paymentMethodV2: paymentMethod,
    status: 'pending',
    precision: 'paise',
    duplicateCheck: dedup,
    proofDocument: {
      fileUrl: String(receiptUrl).trim(),
      uploadedAt: new Date(),
      verificationStatus: 'PENDING'
    },
    submittedAt: new Date(),
  });

  booking.status = 'UNDER_VERIFICATION';
  await booking.save();

  await User.findByIdAndUpdate(userId, { 'paymentProfile.paymentStatus': 'UNDER_VERIFICATION' });

  emitToAdmins('payment:submitted', { paymentId: payment._id, bookingId: booking._id, amount: submitAmountPaise });

  // Async OCR
  processOcr(payment._id, String(receiptUrl).trim()).catch(e => console.error('[OCR Error]', e));

  return { booking, payment };
}

/**
 * Retrieve booking status + timers
 */
async function getBookingStatus(userId) {
  const user = await User.findById(userId).populate('paymentProfile');
  if (!user?.paymentProfile?.currentBookingId) return null;

  const booking = await Booking.findById(user.paymentProfile.currentBookingId);
  if (!booking) return null;

  const timers = await getTimerStatus(booking._id);

  return { booking, timers };
}

/**
 * Cron task — cancel expired bookings
 */
async function cancelExpiredBookings() {
  const now = new Date();
  
  // Find overdue bookings
  const expiredBookings = await Booking.find({
    status: 'PENDING_BOOKING_PAYMENT',
    'timers.priceLockExpiry': { $lte: now }
  });

  for (const b of expiredBookings) {
    b.status = 'CANCELLED';
    await b.save();
    
    await User.findByIdAndUpdate(b.userId, {
      'paymentProfile.paymentStatus': 'NO_BOOKING',
      'paymentProfile.currentBookingId': null
    });
  }

  return expiredBookings.length;
}

module.exports = {
  initiateBooking,
  submitBookingPayment,
  getBookingStatus,
  cancelExpiredBookings,
  generateBookingId
};
