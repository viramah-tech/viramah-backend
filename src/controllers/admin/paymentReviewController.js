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
      status:      req.query.status,
      paymentType: req.query.paymentType,
      userId:      req.query.userId,
      planId:      req.query.planId,
      page:  parseInt(req.query.page, 10)  || 1,
      limit: parseInt(req.query.limit, 10) || 20,
    });
    return success(res, data, 'Payments');
  } catch (e) { next(e); }
};

const detail = async (req, res, next) => {
  try {
    return success(res, await svc.getPaymentDetail(req.params.paymentId), 'Payment detail');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const approve = async (req, res, next) => {
  try {
    const result = await svc.approvePayment(req.params.paymentId, actorFromReq(req));
    return success(res, result, 'Payment approved');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const reject = async (req, res, next) => {
  try {
    const payment = await svc.rejectPayment(req.params.paymentId, {
      reason: req.body.reason,
      actor:  actorFromReq(req),
    });
    return success(res, payment, 'Payment rejected');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const hold = async (req, res, next) => {
  try {
    const payment = await svc.holdPayment(req.params.paymentId, {
      reason: req.body.reason,
      actor:  actorFromReq(req),
    });
    return success(res, payment, 'Payment placed on hold');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const manual = async (req, res, next) => {
  try {
    const result = await svc.recordManualPayment({
      ...req.body,
      actor: actorFromReq(req),
    });
    return success(res, result, 'Manual payment recorded', 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { list, detail, approve, reject, hold, manual };
