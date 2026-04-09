'use strict';
const bookingService = require('../../services/bookingService');
const timerService   = require('../../services/timerService');
const { success, error } = require('../../utils/apiResponse');

const initiate = async (req, res, next) => {
  try {
    const booking = await bookingService.initiateBooking(req.user._id, {
      roomTypeId: req.body.roomTypeId,
      addOns:     req.body.addOns || {},
    });
    return success(res, { booking }, 'Booking initiated', 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const getMyBooking = async (req, res, next) => {
  try {
    const result = await bookingService.getBookingStatus(req.user._id);
    if (!result) return error(res, 'No active booking found', 404);
    return success(res, result, 'Booking status');
  } catch (e) { next(e); }
};

const submitPayment = async (req, res, next) => {
  try {
    const result = await bookingService.submitBookingPayment(
      req.user._id,
      req.params.id,
      {
        transactionId: req.body.transactionId,
        receiptUrl:    req.body.receiptUrl,
        paymentMethod: req.body.paymentMethod || 'UPI',
        amount:        1618000, // Fixed ₹16,180 in paise
      }
    );
    return success(res, result, 'Booking payment submitted', 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const getTimer = async (req, res, next) => {
  try {
    const timers = await timerService.getTimerStatus(req.params.id);
    return success(res, { timers }, 'Timer status');
  } catch (e) { next(e); }
};

module.exports = { initiate, getMyBooking, submitPayment, getTimer };
