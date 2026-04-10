'use strict';

/**
 * bookingController.js — V2.0 Public booking endpoints.
 *
 * Handles: initiation, dual bill display, payment submission,
 * track selection, booking status, and timer queries.
 */

const bookingService = require('../../services/bookingService');
const timerService   = require('../../services/timerService');
const { success, error } = require('../../utils/apiResponse');

// POST /api/v1/bookings — initiate booking (returns dual bill)
const initiate = async (req, res, next) => {
  try {
    const result = await bookingService.initiateBooking(req.user._id, {
      roomTypeId: req.body.roomTypeId,
      addOns: req.body.addOns || {},
    });
    return success(res, { booking: result }, 'Booking initiated with dual bill', 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// GET /api/v1/bookings/my-booking — current user's active booking + dual bills
const getMyBooking = async (req, res, next) => {
  try {
    const result = await bookingService.getBookingStatus(req.user._id);
    if (!result) return error(res, 'No active booking found', 404);
    return success(res, result, 'Booking status');
  } catch (e) { next(e); }
};

// GET /api/v1/bookings/:id/bills — dual bill display data
const getBills = async (req, res, next) => {
  try {
    const Booking = require('../../models/Booking');
    const booking = await Booking.findById(req.params.id);
    if (!booking) return error(res, 'Booking not found', 404);
    if (String(booking.userId) !== String(req.user._id)) {
      return error(res, 'Forbidden', 403);
    }

    return success(res, {
      bookingId: booking.bookingId,
      status: booking.status,
      bookingBill: booking.displayBills?.bookingBill || null,
      projectedFinalBill: booking.displayBills?.projectedFinalBill || null,
      timerExpiry: booking.timers?.bookingPaymentExpiry || null,
      finalPaymentDeadline: booking.timers?.finalPaymentDeadline || null,
    }, 'Dual bill data');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/bookings/:id/pay — submit booking payment proof
const submitPayment = async (req, res, next) => {
  try {
    const result = await bookingService.submitBookingPayment(
      req.user._id,
      req.params.id,
      {
        transactionId: req.body.transactionId,
        receiptUrl:    req.body.receiptUrl,
        paymentMethod: req.body.paymentMethod || 'UPI',
        amount:        16180,  // Fixed ₹16,180 (rupees)
      }
    );
    return success(res, result, 'Booking payment submitted', 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/bookings/:id/select-track — select FULL_TENURE or HALF_YEARLY
const selectTrack = async (req, res, next) => {
  try {
    const Booking = require('../../models/Booking');
    const { getPricingConfig } = require('../../services/pricingService');

    const booking = await Booking.findById(req.params.id);
    if (!booking) return error(res, 'Booking not found', 404);
    if (String(booking.userId) !== String(req.user._id)) return error(res, 'Forbidden', 403);
    if (!['BOOKING_CONFIRMED', 'TRACK_SELECTED'].includes(booking.status)) {
      return error(res, 'Booking must be confirmed before selecting track', 400);
    }

    const { trackId } = req.body;
    if (!['FULL_TENURE', 'HALF_YEARLY'].includes(trackId)) {
      return error(res, 'Invalid track. Must be FULL_TENURE or HALF_YEARLY', 400);
    }

    const cfg = await getPricingConfig();
    const gstRate = cfg.gst?.rate || 0.18;
    const baseMonthly = cfg.roomPricing?.[booking.selections.roomType]?.baseMonthly || 0;

    // Get effective discount (hierarchical resolution)
    const { getEffectiveDiscount } = require('../../services/discountAdminService');
    const discountInfo = await getEffectiveDiscount(booking._id, trackId);
    const discountPercent = discountInfo.percent;

    // Build installments
    const installments = [];
    if (trackId === 'FULL_TENURE') {
      const subtotal = Math.round(baseMonthly * 11);
      const discountAmount = Math.round(subtotal * (discountPercent / 100));
      const discounted = subtotal - discountAmount;
      const gst = Math.round(discounted * gstRate);
      const total = discounted + gst;
      // Deduct security deposit from total
      const totalAfterDeduction = total - 15000;

      installments.push({
        installmentNumber: 1,
        type: 'FULL_PAYMENT',
        totalAmount: totalAfterDeduction,
        amountPaid: 0,
        amountRemaining: totalAfterDeduction,
        status: 'PENDING',
        dueDate: booking.timers.finalPaymentDeadline,
        partialPayments: [],
        payments: [],
      });
    } else {
      // HALF_YEARLY: 2 installments (6 + 5 months)
      for (const [idx, months] of [[0, 6], [1, 5]]) {
        const subtotal = Math.round(baseMonthly * months);
        const discountAmount = Math.round(subtotal * (discountPercent / 100));
        const discounted = subtotal - discountAmount;
        const gst = Math.round(discounted * gstRate);
        let total = discounted + gst;

        // Deduct security deposit from installment 1 only
        if (idx === 0) total -= 15000;

        const dueDate = idx === 0
          ? booking.timers.finalPaymentDeadline
          : new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000); // ~6 months

        installments.push({
          installmentNumber: idx + 1,
          type: `INSTALLMENT_${idx + 1}`,
          totalAmount: total,
          amountPaid: 0,
          amountRemaining: total,
          status: 'PENDING',
          dueDate,
          partialPayments: [],
          payments: [],
        });
      }
    }

    // Update booking
    booking.paymentPlan.selectedTrack = trackId;
    booking.paymentPlan.selectedAt = new Date();
    booking.paymentPlan.baseAmounts = {
      roomRentTotal: Math.round(baseMonthly * 11),
      messTotal: booking.servicePayments?.mess?.totalAmount || null,
      transportTotal: booking.servicePayments?.transport?.totalAmount || null,
    };

    booking.installments = installments;
    booking.financials.discountType = trackId;
    booking.financials.discountPercentage = discountPercent;
    booking.financials.baseRentPerMonth = baseMonthly;
    booking.financials.baseRentTotal = Math.round(baseMonthly * 11);
    booking.financials.taxRate = gstRate;

    // Calculate grand total
    const roomTotal = installments.reduce((s, i) => s + i.totalAmount, 0);
    const messTotal = booking.servicePayments?.mess?.totalAmount || 0;
    const transportTotal = booking.servicePayments?.transport?.totalAmount || 0;
    booking.financials.grandTotal = roomTotal + messTotal + transportTotal;
    booking.financials.totalPending = booking.financials.grandTotal - (booking.financials.totalPaid || 0);

    booking.status = 'TRACK_SELECTED';
    booking.statusHistory.push({
      status: 'TRACK_SELECTED',
      changedBy: 'USER',
      reason: `Selected ${trackId} payment track (${discountPercent}% discount)`,
    });

    await booking.save();

    return success(res, {
      bookingId: booking.bookingId,
      selectedTrack: trackId,
      discountPercent,
      discountSource: discountInfo.source,
      installments: installments.map(i => ({
        number: i.installmentNumber,
        type: i.type,
        totalAmount: i.totalAmount,
        dueDate: i.dueDate,
      })),
      grandTotal: booking.financials.grandTotal,
    }, `Track ${trackId} selected`);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// GET /api/v1/bookings/:id/payment-page — full payment page data with history
const getPaymentPage = async (req, res, next) => {
  try {
    const { getPaymentPageData } = require('../../services/installmentService');
    const installmentNumber = parseInt(req.query.installment, 10) || 1;
    const data = await getPaymentPageData(req.params.id, installmentNumber);
    return success(res, data, 'Payment page data');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// GET /api/v1/bookings/:id/timer — timer status
const getTimer = async (req, res, next) => {
  try {
    const timers = await timerService.getTimerStatus(req.params.id);
    return success(res, { timers }, 'Timer status');
  } catch (e) { next(e); }
};

module.exports = {
  initiate,
  getMyBooking,
  getBills,
  submitPayment,
  selectTrack,
  getPaymentPage,
  getTimer,
};
