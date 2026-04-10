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

module.exports = { list, stats, detail, forceExpire, extend, adjustCredit };
