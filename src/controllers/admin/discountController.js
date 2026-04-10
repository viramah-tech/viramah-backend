'use strict';

const svc = require('../../services/discount-service');
const { success, error } = require('../../utils/apiResponse');

const actorFromReq = (req) => ({
  userId: req.user?._id,
  name:   req.user?.name || '',
  role:   req.user?.role || '',
});

const list = async (req, res, next) => {
  try { return success(res, await svc.getAllConfigs(), 'Discount configs'); }
  catch (e) { next(e); }
};

const update = async (req, res, next) => {
  try {
    const cfg = await svc.updateGlobalDiscount(req.params.trackId, {
      newRate:  req.body.newRate,
      isActive: req.body.isActive,
      reason:   req.body.reason,
      actor:    actorFromReq(req),
    });
    return success(res, cfg, 'Discount updated');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const history = async (req, res, next) => {
  try {
    return success(res, await svc.getDiscountHistory(req.params.trackId), 'History');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const setOverride = async (req, res, next) => {
  try {
    const adj = await svc.setOverride({
      userId:          req.body.userId,
      newDiscountRate: req.body.newDiscountRate,
      reason:          req.body.reason,
      actor:           actorFromReq(req),
    });
    return success(res, adj, 'Override set', 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const removeOverride = async (req, res, next) => {
  try {
    return success(res, await svc.removeOverride(req.params.userId), 'Override removed');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { list, update, history, setOverride, removeOverride };
