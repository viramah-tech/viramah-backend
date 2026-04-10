'use strict';

const svc = require('../../services/reconciliationService');
const { success, error } = require('../../utils/apiResponse');

const actorFromReq = (req) => ({
  userId: req.user?._id,
  name:   req.user?.name || '',
  role:   req.user?.role || '',
});

const stats = async (req, res, next) => {
  try {
    const data = await svc.getReconciliationStats();
    return success(res, data, 'Reconciliation stats');
  } catch (e) { next(e); }
};

const list = async (req, res, next) => {
  try {
    const data = await svc.listByReconciliation({
      reconStatus: req.query.reconStatus,
      page:  parseInt(req.query.page, 10)  || 1,
      limit: parseInt(req.query.limit, 10) || 20,
    });
    return success(res, data, 'Reconciliation list');
  } catch (e) { next(e); }
};

const uploadStatement = async (req, res, next) => {
  try {
    const transactions = req.body.transactions;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return error(res, 'transactions must be a non-empty array', 400);
    }
    const result = await svc.processBankStatement(transactions);
    return success(res, result, 'Bank statement processed');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const resolve = async (req, res, next) => {
  try {
    const payment = await svc.resolveDiscrepancy(req.params.id, {
      resolution: req.body.resolution,
      actor: actorFromReq(req),
    });
    return success(res, { payment }, 'Discrepancy resolved');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { stats, list, uploadStatement, resolve };
