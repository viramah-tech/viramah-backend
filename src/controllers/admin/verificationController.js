'use strict';
const svc = require('../../services/paymentReviewService');
const { success, error } = require('../../utils/apiResponse');

const actorFromReq = (req) => ({
  userId: req.user?._id,
  name:   req.user?.name || '',
  role:   req.user?.role || '',
});

const list = async (req, res, next) => {
  try {
    const data = await svc.listPayments({
      status:      req.query.status || 'pending',
      paymentType: req.query.paymentType,
      userId:      req.query.userId,
      riskLevel:   req.query.riskLevel, // 'high' | 'medium' | 'low'
      page:  parseInt(req.query.page, 10)  || 1,
      limit: parseInt(req.query.limit, 10) || 20,
    });
    return success(res, data, 'Verification queue');
  } catch (e) { next(e); }
};

const detail = async (req, res, next) => {
  try {
    const data = await svc.getPaymentDetail(req.params.id);
    return success(res, data, 'Verification detail');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// Approve booking payment: transitions booking to BOOKING_CONFIRMED + starts 7-day timer
const approveBooking = async (req, res, next) => {
  try {
    const result = await svc.approveBookingPayment(req.params.id, actorFromReq(req));
    return success(res, result, 'Booking payment approved — 7-day final payment window started');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const reject = async (req, res, next) => {
  try {
    const result = await svc.rejectPayment(req.params.id, {
      reason: req.body.reason,
      actor:  actorFromReq(req),
    });
    return success(res, result, 'Verification rejected');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const hold = async (req, res, next) => {
  try {
    const result = await svc.holdPayment(req.params.id, {
      reason: req.body.reason,
      actor:  actorFromReq(req),
    });
    return success(res, result, 'Verification placed on hold');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const stats = async (req, res, next) => {
  try {
    const data = await svc.getUnifiedStats();
    return success(res, data, 'Verification queue statistics');
  } catch (e) { next(e); }
};

module.exports = { list, detail, approveBooking, reject, hold, stats };
