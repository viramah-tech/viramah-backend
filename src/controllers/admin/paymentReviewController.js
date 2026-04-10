'use strict';

const svc = require('../../services/payment-review-service');
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
    const type = req.body.type; // 'booking' | 'final' | undefined
    let result;
    if (type === 'booking') {
      result = await svc.approveBookingPayment(req.params.paymentId, actorFromReq(req));
    } else {
      result = await svc.approvePayment(req.params.paymentId, actorFromReq(req));
    }
    return success(res, result, type === 'booking' ? 'Booking payment approved' : 'Payment approved');
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

const bulkApproveCtrl = async (req, res, next) => {
  try {
    const { paymentIds } = req.body;
    const results = await svc.bulkApprove(paymentIds, actorFromReq(req));
    return success(res, results, 'Bulk approve completed');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const bulkRejectCtrl = async (req, res, next) => {
  try {
    const { paymentIds, reason } = req.body;
    const results = await svc.bulkReject(paymentIds, reason, actorFromReq(req));
    return success(res, results, 'Bulk reject completed');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const unifiedStats = async (req, res, next) => {
  try {
    const stats = await svc.getUnifiedStats();
    return success(res, stats, 'Unified payment stats');
  } catch (e) { next(e); }
};

module.exports = { list, detail, approve, reject, hold, manual, bulkApprove: bulkApproveCtrl, bulkReject: bulkRejectCtrl, unifiedStats };
