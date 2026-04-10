'use strict';

const svc = require('../../services/booking-service');
const { success, error } = require('../../utils/apiResponse');

const actorFromReq = (req) => ({
  userId: req.user?._id,
  name:   req.user?.name || '',
  role:   req.user?.role || '',
});

const list = async (req, res, next) => {
  try {
    const data = await svc.listBookings({
      status: req.query.status,
      userId: req.query.userId,
      page:  parseInt(req.query.page, 10)  || 1,
      limit: parseInt(req.query.limit, 10) || 20,
    });
    return success(res, data, 'Bookings');
  } catch (e) { next(e); }
};

const stats = async (req, res, next) => {
  try {
    const data = await svc.getBookingStats();
    return success(res, data, 'Booking stats');
  } catch (e) { next(e); }
};

const detail = async (req, res, next) => {
  try {
    const Booking = require('../../models/Booking');
    const booking = await Booking.findById(req.params.id)
      .populate('userId', 'userId name email phone roomNumber')
      .populate('selections.roomTypeId', 'name displayName');
    if (!booking) return error(res, 'Booking not found', 404);
    return success(res, { booking }, 'Booking detail');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const forceExpire = async (req, res, next) => {
  try {
    const booking = await svc.forceExpireBooking(req.params.id, actorFromReq(req));
    return success(res, { booking }, 'Booking force expired');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const extend = async (req, res, next) => {
  try {
    const booking = await svc.extendDeadline(req.params.id, {
      days:  req.body.days,
      actor: actorFromReq(req),
    });
    return success(res, { booking }, `Deadline extended by ${req.body.days} days`);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const adjustCredit = async (req, res, next) => {
  try {
    const booking = await svc.adjustCredit(req.params.id, {
      amount: req.body.amount,
      reason: req.body.reason,
      actor:  actorFromReq(req),
    });
    return success(res, { booking }, 'Credit adjusted');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const setTimer = async (req, res, next) => {
  try {
    const { timerType, deadline } = req.body;
    // timerType: 'bookingPaymentExpiry' | 'finalPaymentDeadline'
    if (!['bookingPaymentExpiry', 'finalPaymentDeadline'].includes(timerType)) {
      return error(res, 'timerType must be bookingPaymentExpiry or finalPaymentDeadline', 400);
    }
    if (!deadline) {
      return error(res, 'deadline is required (ISO date string)', 400);
    }
    const Booking = require('../../models/Booking');
    const booking = await Booking.findById(req.params.id);
    if (!booking) return error(res, 'Booking not found', 404);

    const newDeadline = new Date(deadline);
    if (isNaN(newDeadline.getTime())) {
      return error(res, 'Invalid deadline date', 400);
    }

    booking.timers[timerType] = newDeadline;
    booking.statusHistory.push({
      status: booking.status,
      changedBy: req.user._id,
      reason: `Admin set ${timerType} to ${newDeadline.toISOString()}`,
    });
    await booking.save();

    return success(res, {
      bookingId: booking.bookingId,
      timerType,
      deadline: newDeadline,
    }, `Timer ${timerType} updated`);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { list, stats, detail, forceExpire, extend, adjustCredit, setTimer };
