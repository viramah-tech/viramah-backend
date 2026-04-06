'use strict';

const svc = require('../../services/planAdminService');
const { success, error } = require('../../utils/apiResponse');

const actor = (req) => ({
  userId: req.user?._id, name: req.user?.name || '', role: req.user?.role || '',
});

const wrap = (fn) => async (req, res, next) => {
  try { return await fn(req, res); }
  catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = {
  list:    wrap(async (req, res) => success(res, await svc.listPlans({
    status: req.query.status, trackId: req.query.trackId, userId: req.query.userId,
    page: parseInt(req.query.page, 10) || 1, limit: parseInt(req.query.limit, 10) || 20,
  }), 'Plans')),

  detail:  wrap(async (req, res) => success(res, await svc.getPlanDetail(req.params.planId), 'Plan detail')),

  setPhase2Date: wrap(async (req, res) =>
    success(res, await svc.setPhase2Date(req.params.planId, { dueDate: req.body.dueDate, actor: actor(req) }), 'Phase 2 date set')),

  holdPhase: wrap(async (req, res) =>
    success(res, await svc.holdPhase(req.params.planId, { phaseNumber: req.body.phaseNumber, reason: req.body.reason, actor: actor(req) }), 'Phase held')),

  unlockPhase: wrap(async (req, res) =>
    success(res, await svc.unlockPhase(req.params.planId, { phaseNumber: req.body.phaseNumber, actor: actor(req) }), 'Phase unlocked')),

  customCharge: wrap(async (req, res) =>
    success(res, await svc.addCustomCharge({ ...req.body, actor: actor(req) }), 'Custom charge added', 201)),

  waiver: wrap(async (req, res) =>
    success(res, await svc.addWaiver({ ...req.body, actor: actor(req) }), 'Waiver added', 201)),
};
