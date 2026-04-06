'use strict';

const svc = require('../../services/accountantService');
const { success, error } = require('../../utils/apiResponse');

const wrap = (fn) => async (req, res, next) => {
  try { return await fn(req, res); }
  catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = {
  summary: wrap(async (req, res) =>
    success(res, await svc.getSummary(), 'Financial summary')),

  overdue: wrap(async (req, res) =>
    success(res, await svc.getOverdue(), 'Overdue phases')),

  ledger: wrap(async (req, res) =>
    success(res, await svc.getLedger({
      userId: req.query.userId,
      sourceType: req.query.sourceType,
      page: parseInt(req.query.page, 10) || 1,
      limit: parseInt(req.query.limit, 10) || 50,
    }), 'Ledger')),

  discountImpact: wrap(async (req, res) =>
    success(res, await svc.getDiscountImpact(), 'Discount impact')),

  adjustments: wrap(async (req, res) =>
    success(res, await svc.getAdjustmentsList({
      type: req.query.type,
      userId: req.query.userId,
      page: parseInt(req.query.page, 10) || 1,
      limit: parseInt(req.query.limit, 10) || 50,
    }), 'Adjustments')),
};
