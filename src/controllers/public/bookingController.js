'use strict';

/**
 * bookingController.js — V2.0 Public booking endpoints.
 *
 * Handles: initiation, dual bill display, payment submission,
 * track selection, booking status, and timer queries.
 */

const bookingService = require('../../services/booking-service');
const timerService   = require('../../services/timer-service');
const { success, error } = require('../../utils/apiResponse');
const DEBUG_BOOKING_FLOW = process.env.DEBUG_BOOKING_FLOW === '1';

const bookingLog = (...args) => {
  if (DEBUG_BOOKING_FLOW) {
    console.log('[booking-controller]', ...args);
  }
};

// POST /api/v1/bookings — initiate booking (returns dual bill)
const initiate = async (req, res, next) => {
  try {
    bookingLog('initiate:request', {
      requestId: req.id,
      userId: String(req.user?._id || ''),
      roomTypeId: req.body?.roomTypeId,
      addOns: req.body?.addOns || {},
    });
    const result = await bookingService.initiateBooking(req.user._id, {
      roomTypeId: req.body.roomTypeId,
      addOns: req.body.addOns || {},
    });
    bookingLog('initiate:success', {
      requestId: req.id,
      userId: String(req.user?._id || ''),
      bookingId: result?.bookingId || result?._id || null,
      status: result?.status || null,
    });
    return success(res, { booking: result }, 'Booking initiated with dual bill', 201);
  } catch (e) {
    bookingLog('initiate:error', {
      requestId: req.id,
      userId: String(req.user?._id || ''),
      message: e?.message,
      statusCode: e?.statusCode || null,
    });
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// GET /api/v1/bookings/my-booking — current user's active booking + dual bills
const getMyBooking = async (req, res, next) => {
  try {
    bookingLog('my-booking:request', {
      requestId: req.id,
      userId: String(req.user?._id || ''),
    });
    const result = await bookingService.getBookingStatus(req.user._id);
    if (!result) {
      bookingLog('my-booking:none', {
        requestId: req.id,
        userId: String(req.user?._id || ''),
      });
      return error(res, 'No active booking found', 404);
    }
    bookingLog('my-booking:success', {
      requestId: req.id,
      userId: String(req.user?._id || ''),
      bookingId: result?.bookingId || result?._id || null,
      status: result?.status || null,
    });
    return success(res, result, 'Booking status');
  } catch (e) { next(e); }
};

// GET /api/v1/bookings/:id — fetch specific booking details
const getById = async (req, res, next) => {
  try {
    const Booking = require('../../models/Booking');
    const booking = await Booking.findById(req.params.id);
    
    if (!booking) return error(res, 'Booking not found', 404);
    if (String(booking.userId) !== String(req.user._id)) {
      return error(res, 'Forbidden', 403);
    }

    return success(res, { data: booking }, 'Booking details');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
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

    let projectedFinalBill = booking.displayBills?.projectedFinalBill || null;
    const roomRentBase = projectedFinalBill?.fullTenure?.roomRent?.baseMonthly || projectedFinalBill?.fullTenure?.roomRent?.subtotal;

    // Auto-heal missing or zero projected bills
    if (!roomRentBase || roomRentBase <= 0) {
      try {
        const { calculateProjectedFinalBill } = require('../../services/booking-service');
        const { getPricingConfig } = require('../../services/pricing-service');
        const cfg = await getPricingConfig();
        const hasMess = booking.selections?.mess?.selected || false;
        const hasTransport = booking.selections?.transport?.selected || false;
        
        projectedFinalBill = await calculateProjectedFinalBill(
          booking.selections?.roomType || booking.selections?.roomTypeCode,
          booking.selections?.tenure || 11,
          hasMess,
          hasTransport,
          cfg,
          booking.userId
        );

        // Lazily save this fix to the document so we don't calculate every time
        if (projectedFinalBill) {
          booking.displayBills = booking.displayBills || {};
          booking.displayBills.projectedFinalBill = projectedFinalBill;
          await booking.save();
        }
      } catch (err) {
        console.error("[getBills] Failed to auto-heal projectedFinalBill:", err.message);
      }
    }

    return success(res, {
      bookingId: booking.bookingId,
      _id: booking._id,
      status: booking.status,
      bookingBill: booking.displayBills?.bookingBill || null,
      projectedFinalBill,
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
        amount:        16000,  // Fixed ₹16,000 (15000 security + 1000 registration, no GST)
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
    const { getPricingConfig } = require('../../services/pricing-service');

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
    const gstRate = cfg.gst?.rate || 0.12;
    const roomTypeCode = booking.selections.roomTypeCode;
    const baseMonthly = cfg.roomPricing?.[roomTypeCode]?.baseMonthly || 0;

    if (!baseMonthly) {
      return error(res, `PRICING_CONFIG_MISSING: no base monthly for room type ${roomTypeCode}`, 422);
    }

    const { getEffectiveDiscount } = require('../../services/discount-admin-service');
    const discountInfo = await getEffectiveDiscount(booking._id, trackId);
    const discountPercent = discountInfo.percent;
    const discountFraction = discountPercent / 100;

    // Per-month rounding (canonical formula matching tariff plan)
    const discountedBase = Math.round(baseMonthly * (1 - discountFraction));
    const gstAmt         = Math.round(discountedBase * gstRate);
    const monthlyTotal   = discountedBase + gstAmt;

    const installments = [];

    if (trackId === 'FULL_TENURE') {
      const roomRentTotal = monthlyTotal * 11;
      const totalAfterDeduction = roomRentTotal - 15000; // deduct security deposit

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
      // HALF_YEARLY: installment 1 = 6 months, installment 2 = 5 months
      const inst1Room = monthlyTotal * 6;
      const inst2Room = monthlyTotal * 5;

      // Installment 1: room rent (6mo) − security deposit
      installments.push({
        installmentNumber: 1,
        type: 'INSTALLMENT_1',
        totalAmount: inst1Room - 15000,
        amountPaid: 0,
        amountRemaining: inst1Room - 15000,
        status: 'PENDING',
        dueDate: booking.timers.finalPaymentDeadline,
        partialPayments: [],
        payments: [],
      });

      // Installment 2: room rent (5mo), no deduction
      const inst2DueDate = booking.timers.finalPaymentDeadline
        ? new Date(new Date(booking.timers.finalPaymentDeadline).getTime() + 6 * 30 * 24 * 60 * 60 * 1000)
        : new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000);

      installments.push({
        installmentNumber: 2,
        type: 'INSTALLMENT_2',
        totalAmount: inst2Room,
        amountPaid: 0,
        amountRemaining: inst2Room,
        status: 'PENDING',
        dueDate: inst2DueDate,
        partialPayments: [],
        payments: [],
      });
    }

    // Persist
    booking.paymentPlan.selectedTrack = trackId;
    booking.paymentPlan.selectedAt = new Date();
    booking.paymentPlan.baseAmounts = {
      roomRentTotal: monthlyTotal * 11,
      messTotal: booking.servicePayments?.mess?.totalAmount || null,
      transportTotal: booking.servicePayments?.transport?.totalAmount || null,
    };

    booking.installments = installments;
    booking.financials.discountType = trackId;
    booking.financials.discountPercentage = discountPercent;
    booking.financials.baseRentPerMonth = baseMonthly;
    booking.financials.baseRentTotal = monthlyTotal * 11;
    booking.financials.taxRate = gstRate;

    const roomTotal       = installments.reduce((s, i) => s + i.totalAmount, 0);
    const messTotal       = booking.servicePayments?.mess?.totalAmount || 0;
    const transportTotal  = booking.servicePayments?.transport?.totalAmount || 0;
    booking.financials.grandTotal    = roomTotal + messTotal + transportTotal;
    booking.financials.totalPending  = booking.financials.grandTotal - (booking.financials.totalPaid || 0);

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
    const { getPaymentPageData } = require('../../services/installment-service');
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
  getById,
  getBills,
  submitPayment,
  selectTrack,
  getPaymentPage,
  getTimer,
};
