'use strict';

/**
 * bookingService.js — V2.0 Entry point for Booking-first flow.
 *
 * Key V2.0 changes:
 *  - Dual bill generation (booking + projected final) at booking creation
 *  - Projected bills for BOTH track options shown upfront
 *  - Explicit -₹15,000 security deposit deduction line
 *  - Atomic booking approval with 7-day timer start
 *  - Service payment initialization (mess/transport)
 *
 * ALL monetary values in RUPEES (INR).
 */

const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const User = require('../models/User');
const RoomType = require('../models/RoomType');
const Payment = require('../models/Payment');
const { getPricingConfig } = require('./pricing-service');
const { startPriceLock, startPaymentWindow, getTimerStatus, cancelTimer } = require('./timer-service');
const { processOcr, checkDuplicateUtr } = require('./payment-verification-service');
const { emitToAdmins, emitToUser } = require('./socket-service');

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Calculate room rent for a given track option.
 * @param {number} baseMonthly - Monthly base rent (rupees)
 * @param {number} months - Number of months
 * @param {number} discountPercent - Discount as whole number (e.g. 40 for 40%)
 * @param {number} gstRate - GST rate as decimal (e.g. 0.18)
 * @returns {object} Room rent breakdown
 */
function calculateRoomRent(baseMonthly, months, discountPercent, gstRate = 0.18) {
  const subtotal = Math.round(baseMonthly * months);
  const discountAmount = Math.round(subtotal * (discountPercent / 100));
  const discountedSubtotal = subtotal - discountAmount;
  const gstAmount = Math.round(discountedSubtotal * gstRate);
  const total = discountedSubtotal + gstAmount;

  return {
    baseMonthly,
    tenure: months,
    subtotal,
    discountPercent,
    discountAmount,
    discountedSubtotal,
    gstRate,
    gstAmount,
    total,
  };
}

/**
 * Calculate service cost (mess or transport).
 */
function calculateService(monthlyRate, tenure, discountPercent = 0) {
  if (!monthlyRate || monthlyRate <= 0) return null;
  const subtotal = Math.round(monthlyRate * tenure);
  const discountAmount = Math.round(subtotal * (discountPercent / 100));
  const total = subtotal - discountAmount;
  return { monthly: monthlyRate, tenure, subtotal, discountPercent, discountAmount, total };
}

/**
 * Build the static booking bill breakdown (always ₹16,180).
 */
function buildBookingBill(cfg) {
  const secDep = cfg.bookingAmount?.securityDeposit || 15000;
  const regFee = cfg.bookingAmount?.registrationFee || 1000;
  const regGstRate = cfg.bookingAmount?.registrationGstRate || 0.18;
  const regGst = Math.round(regFee * regGstRate);
  const total = secDep + regFee + regGst;

  return {
    securityDeposit: { amount: secDep, gstRate: 0, gstAmount: 0, total: secDep },
    registrationFee: { baseAmount: regFee, gstRate: regGstRate, gstAmount: regGst, total: regFee + regGst },
    totalPayable: total,
    breakdown: [
      { label: 'Security Deposit (Refundable)', amount: secDep, type: 'SECURITY' },
      { label: 'Registration Fee', amount: regFee, type: 'REGISTRATION_BASE' },
      { label: 'GST (18%)', amount: regGst, type: 'TAX' },
    ],
  };
}

/* ─── Core Functions ──────────────────────────────────────────────────────── */

/**
 * Step 1: Create booking with DUAL BILL display data.
 * Shows both booking amount AND projected final bill for both track options.
 */
async function initiateBooking(userId, { roomTypeId, addOns = {} }) {
  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);

  // Check for existing active booking
  const existing = await Booking.findActiveForUser(userId);
  if (existing) {
    throw err('You already have an active booking', 409);
  }

  const roomType = await RoomType.findById(roomTypeId);
  if (!roomType) throw err('Room type not found', 404);

  const cfg = await getPricingConfig();

  // Build dual bills
  const bookingBill = buildBookingBill(cfg);
  const projectedFinalBill = await calculateProjectedFinalBill(
    roomType.name, 11, !!addOns.mess, !!addOns.transport, cfg, userId
  );

  // Calculate service totals for servicePayments initialization
  const messTotalAmount = addOns.mess
    ? (cfg.servicePricing?.mess?.monthly || 2000) * 11
    : null;
  const transportTotalAmount = addOns.transport
    ? (cfg.servicePricing?.transport?.monthly || 2000) * 11
    : null;

  const booking = await Booking.create({
    userId,
    selections: {
      roomType: roomType.name,
      roomTypeId: roomType._id,
      tenure: 11,
      mess: { selected: !!addOns.mess, type: addOns.mess ? 'LUNCH' : null },
      transport: { selected: !!addOns.transport, routes: addOns.transportRoutes || [] },
    },
    displayBills: {
      bookingBill,
      projectedFinalBill,
    },
    financials: {
      securityDeposit: 15000,
      registrationFee: 1000,
      registrationGst: 180,
      totalBookingAmount: 16180,
      baseRentPerMonth: cfg.roomPricing?.[roomType.name]?.baseMonthly || null,
      messTotal: messTotalAmount,
      transportTotal: transportTotalAmount,
      totalPaid: 0,
    },
    servicePayments: {
      mess: {
        totalAmount: messTotalAmount,
        status: addOns.mess ? 'PENDING' : 'NOT_APPLICABLE',
      },
      transport: {
        totalAmount: transportTotalAmount,
        status: addOns.transport ? 'PENDING' : 'NOT_APPLICABLE',
      },
    },
    timers: {
      bookingPaymentExpiry: new Date(Date.now() + (cfg.timers?.bookingPaymentMinutes || 30) * 60 * 1000),
    },
    status: 'PENDING_BOOKING_PAYMENT',
  });

  // Start price lock timer
  await startPriceLock(booking._id, cfg.timers?.priceLockMinutes || 15);

  // Update user
  user.paymentProfile = user.paymentProfile || {};
  user.paymentProfile.currentBookingId = booking._id;
  user.paymentProfile.paymentStatus = 'BOOKING_PENDING';
  await user.save();

  return {
    bookingId: booking.bookingId,
    _id: booking._id,
    bookingBill: booking.displayBills.bookingBill,
    projectedFinalBill: booking.displayBills.projectedFinalBill,
    timerExpiry: booking.timers.bookingPaymentExpiry,
    status: booking.status,
  };
}

/**
 * Calculate PROJECTED final bill for BOTH track options.
 * This is what users see BEFORE selecting a track.
 */
async function calculateProjectedFinalBill(roomTypeName, tenure, hasMess, hasTransport, cfg, userId) {
  const baseMonthly = cfg.roomPricing?.[roomTypeName]?.baseMonthly || 0;
  const gstRate = cfg.gst?.rate || 0.18;

  // Check for user-specific discount overrides
  let fullDiscount = cfg.discounts?.fullTenure?.defaultPercent || 40;
  let halfDiscount = cfg.discounts?.halfYearly?.defaultPercent || 25;

  if (userId) {
    const user = await User.findById(userId);
    if (user?.paymentProfile?.discountEligibility) {
      const elig = user.paymentProfile.discountEligibility;
      // Check active special discounts
      const activeSpecial = elig.specialDiscounts?.find(
        d => d.validUntil > new Date() && !d.appliedToBookingId
      );
      if (activeSpecial) {
        fullDiscount = Math.max(fullDiscount, activeSpecial.discountPercent);
        halfDiscount = Math.max(halfDiscount, activeSpecial.discountPercent);
      }
    }
  }

  // Mess & transport calculations
  const messData = hasMess ? calculateService(cfg.servicePricing?.mess?.monthly || 2000, tenure) : null;
  const transportData = hasTransport ? calculateService(cfg.servicePricing?.transport?.monthly || 2000, tenure) : null;

  // ── Full Tenure Option (40% discount by default) ──
  const fullRoomRent = calculateRoomRent(baseMonthly, tenure, fullDiscount, gstRate);
  const fullGrandTotal = fullRoomRent.total
    + (messData?.total || 0)
    + (transportData?.total || 0);
  const fullAfterDeductions = fullGrandTotal - 15000;  // Explicit -₹15,000

  const fullTenure = {
    track: 'FULL_TENURE',
    discountPercent: fullDiscount,
    roomRent: fullRoomRent,
    mess: messData,
    transport: transportData,
    deductions: {
      securityDeposit: { amount: 15000, label: 'Security Deposit Credit' },
      referralCredits: [],
      otherCredits: [],
    },
    grandTotal: fullGrandTotal,
    totalAfterDeductions: fullAfterDeductions,
  };

  // ── Half Yearly Option (25% discount by default) ──
  const halfFirstRent = calculateRoomRent(baseMonthly, 6, halfDiscount, gstRate);
  const halfSecondRent = calculateRoomRent(baseMonthly, 5, halfDiscount, gstRate);
  const halfGrandTotal = halfFirstRent.total + halfSecondRent.total
    + (messData?.total || 0)
    + (transportData?.total || 0);
  const halfAfterDeductions = halfGrandTotal - 15000;

  const halfYearly = {
    track: 'HALF_YEARLY',
    discountPercent: halfDiscount,
    firstInstallment: {
      months: 6,
      totalAmount: halfFirstRent.total,
      breakdown: halfFirstRent,
    },
    secondInstallment: {
      months: 5,
      dueDate: null, // Set after booking confirmation
      totalAmount: halfSecondRent.total,
      breakdown: halfSecondRent,
    },
    mess: messData,
    transport: transportData,
    deductions: {
      securityDeposit: { amount: 15000, label: 'Security Deposit Credit' },
      referralCredits: [],
      otherCredits: [],
    },
    grandTotal: halfGrandTotal,
    totalAfterDeductions: halfAfterDeductions,
  };

  return { fullTenure, halfYearly, effectiveDate: new Date() };
}

/**
 * Step 2: Submit booking payment proof.
 */
async function submitBookingPayment(userId, bookingId, { transactionId, receiptUrl, paymentMethod, amount }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);
  if (String(booking.userId) !== String(userId)) throw err('Forbidden', 403);
  if (booking.status !== 'PENDING_BOOKING_PAYMENT') throw err('Invalid booking status for payment', 400);

  // Cancel price lock since they initiated payment
  await cancelTimer(booking._id, 'price-lock');

  // Verify amount matches ₹16,180
  const submitAmount = Number(amount);
  if (submitAmount !== booking.financials.totalBookingAmount) {
    throw err(`Booking amount must be exactly ₹${booking.financials.totalBookingAmount.toLocaleString()}`, 400);
  }

  // Duplicate UTR check
  const dedup = await checkDuplicateUtr(transactionId, submitAmount, new Date().toISOString());

  const payment = await Payment.create({
    userId,
    bookingId: booking._id,
    paymentType: 'BOOKING',
    type: 'BOOKING',
    category: 'SECURITY_DEPOSIT',
    amount: submitAmount,

    // V2.0 structured amounts
    amounts: {
      baseAmount: submitAmount,
      totalAmount: submitAmount,
    },

    // V2.0 structured method
    method: {
      type: paymentMethod === 'CASH' ? 'CASH' : (paymentMethod === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'UPI'),
    },

    transactionId: String(transactionId || '').trim(),
    utrNumber: String(transactionId || '').trim(),
    receiptUrl: String(receiptUrl || '').trim(),
    paymentMethod: paymentMethod || '',
    paymentMethodV2: paymentMethod || null,
    status: 'pending',
    duplicateCheck: dedup,
    proofDocument: {
      fileUrl: String(receiptUrl || '').trim(),
      uploadedAt: new Date(),
      verificationStatus: 'PENDING',
    },
    submittedAt: new Date(),
  });

  booking.status = 'UNDER_VERIFICATION';
  booking.statusHistory.push({
    status: 'UNDER_VERIFICATION',
    changedBy: 'USER',
    reason: 'Booking payment submitted',
  });
  await booking.save();

  await User.findByIdAndUpdate(userId, { 'paymentProfile.paymentStatus': 'UNDER_VERIFICATION' });

  emitToAdmins('payment:submitted', {
    paymentId: payment._id,
    bookingId: booking._id,
    amount: submitAmount,
  });

  // Async OCR
  processOcr(payment._id, String(receiptUrl || '').trim()).catch(e =>
    console.error('[OCR Error]', e)
  );

  return { booking, payment };
}

/**
 * Admin: Approve booking payment — starts the 7-day timer.
 * Uses a MongoDB transaction for atomicity.
 */
async function approveBookingPayment(paymentId, adminId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await Payment.findById(paymentId).session(session);
    if (!payment) throw err('Payment not found', 404);

    const booking = await Booking.findById(payment.bookingId).session(session);
    if (!booking) throw err('Booking not found', 404);

    // 1. Update payment status
    payment.status = 'approved';
    payment.adminActions.push({
      action: 'APPROVE',
      adminId,
      timestamp: new Date(),
      previousStatus: 'pending',
      newStatus: 'approved',
    });
    payment.reviewedAt = new Date();
    payment.completedAt = new Date();
    await payment.save({ session });

    // 2. Update booking to BOOKING_CONFIRMED + start 7-day timer
    const cfg = await getPricingConfig();
    const finalPaymentDays = cfg.timers?.finalPaymentDays || 7;
    const deadline = new Date(Date.now() + finalPaymentDays * 24 * 60 * 60 * 1000);

    booking.status = 'BOOKING_CONFIRMED';
    booking.financials.totalPaid = (booking.financials.totalPaid || 0) + payment.amount;
    booking.timers.finalPaymentDeadline = deadline;
    booking.statusHistory.push({
      status: 'BOOKING_CONFIRMED',
      changedBy: adminId,
      reason: 'Booking payment approved',
    });
    await booking.save({ session });

    // 3. Update user status
    await User.findByIdAndUpdate(
      booking.userId,
      { 'paymentProfile.paymentStatus': 'BOOKING_CONFIRMED' },
      { session }
    );

    await session.commitTransaction();

    // 4. Notify user (outside transaction)
    emitToUser(booking.userId, 'booking:confirmed', {
      bookingId: booking.bookingId,
      finalPaymentDeadline: deadline,
    });

    return {
      bookingId: booking.bookingId,
      status: 'BOOKING_CONFIRMED',
      finalPaymentDeadline: deadline,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Retrieve booking status with dual bills and timers.
 */
async function getBookingStatus(userId) {
  const user = await User.findById(userId);
  let bookingId = user?.paymentProfile?.currentBookingId;
  let booking = null;

  if (bookingId) {
    booking = await Booking.findById(bookingId);
  }

  // Fallback: If user profile is out of sync, search active bookings directly
  if (!booking) {
    booking = await Booking.findActiveForUser(userId);
    // Auto-heal the user record
    if (booking && user) {
      user.paymentProfile = user.paymentProfile || {};
      user.paymentProfile.currentBookingId = booking._id;
      user.paymentProfile.paymentStatus = user.paymentProfile.paymentStatus || 'BOOKING_PENDING';
      await user.save().catch(e => console.error('[Auto-heal] Failed to sync user paymentProfile', e));
    }
  }

  if (!booking) return null;

  const timers = await getTimerStatus(booking._id);

  return {
    booking,
    timers,
    displayBills: booking.displayBills,
  };
}

/**
 * Cancel expired bookings (cron task).
 */
async function cancelExpiredBookings() {
  const now = new Date();

  const expired = await Booking.find({
    status: 'PENDING_BOOKING_PAYMENT',
    'timers.bookingPaymentExpiry': { $lte: now },
  });

  for (const b of expired) {
    b.status = 'CANCELLED';
    b.statusHistory.push({
      status: 'CANCELLED',
      changedBy: 'SYSTEM',
      reason: 'Booking payment window expired',
    });
    await b.save();

    await User.findByIdAndUpdate(b.userId, {
      'paymentProfile.paymentStatus': 'NO_BOOKING',
      'paymentProfile.currentBookingId': null,
    });
  }

  return expired.length;
}

/* ─── Admin Functions ─────────────────────────────────────────────────────── */

async function listBookings({ status, userId, page = 1, limit = 20 } = {}) {
  const q = {};
  if (status) q.status = status;
  if (userId) q.userId = userId;

  const skip = (page - 1) * limit;
  const [bookings, total] = await Promise.all([
    Booking.find(q)
      .populate('userId', 'userId name email phone roomNumber')
      .populate('selections.roomTypeId', 'name displayName')
      .sort({ createdAt: -1 })
      .skip(skip).limit(limit)
      .lean(),
    Booking.countDocuments(q),
  ]);

  // Enrich with timer calculations
  for (const b of bookings) {
    b._timers = {};
    if (b.timers?.bookingPaymentExpiry) {
      b._timers.bookingPaymentRemaining = Math.max(0, Math.floor((new Date(b.timers.bookingPaymentExpiry).getTime() - Date.now()) / 1000));
    }
    if (b.timers?.finalPaymentDeadline) {
      b._timers.finalPaymentRemaining = Math.max(0, Math.floor((new Date(b.timers.finalPaymentDeadline).getTime() - Date.now()) / 1000));
    }
  }

  return { bookings, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function getBookingStats() {
  const pipeline = await Booking.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const stats = { total: 0 };
  pipeline.forEach(s => { stats[s._id] = s.count; stats.total += s.count; });
  return stats;
}

async function forceExpireBooking(bookingId, actor) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);
  if (['FULLY_PAID', 'COMPLETED', 'CLOSED', 'CANCELLED'].includes(booking.status)) {
    throw err(`Cannot expire a ${booking.status} booking`, 400);
  }

  booking.status = 'CANCELLED';
  booking.statusHistory.push({ status: 'CANCELLED', changedBy: actor, reason: 'Force expired by admin' });
  await booking.save();

  await User.findByIdAndUpdate(booking.userId, {
    'paymentProfile.paymentStatus': 'NO_BOOKING',
    'paymentProfile.currentBookingId': null,
  });

  return booking;
}

async function extendDeadline(bookingId, { days, actor }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);
  if (!['BOOKING_CONFIRMED', 'FINAL_PAYMENT_PENDING', 'OVERDUE'].includes(booking.status)) {
    throw err(`Cannot extend deadline for ${booking.status} booking`, 400);
  }

  const current = booking.timers?.finalPaymentDeadline || new Date();
  const extended = new Date(current);
  extended.setDate(extended.getDate() + Number(days));
  booking.timers.finalPaymentDeadline = extended;

  if (booking.status === 'OVERDUE') {
    booking.status = 'FINAL_PAYMENT_PENDING';
  }

  booking.statusHistory.push({
    status: booking.status,
    changedBy: actor,
    reason: `Deadline extended by ${days} days`,
  });
  await booking.save();

  return booking;
}

async function adjustCredit(bookingId, { amount, reason, actor }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  booking.financials.totalPaid = (booking.financials.totalPaid || 0) + Number(amount);

  booking.statusHistory.push({
    status: booking.status,
    changedBy: actor,
    reason: `Credit adjusted by ₹${amount}: ${reason}`,
  });
  await booking.save();

  return booking;
}

module.exports = {
  initiateBooking,
  submitBookingPayment,
  approveBookingPayment,
  calculateProjectedFinalBill,
  getBookingStatus,
  cancelExpiredBookings,
  listBookings,
  getBookingStats,
  forceExpireBooking,
  extendDeadline,
  adjustCredit,
};
