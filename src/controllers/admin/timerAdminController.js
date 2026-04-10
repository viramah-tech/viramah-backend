'use strict';

/**
 * timerAdminController.js — V2.0 Admin timer control endpoints.
 */

const timerAdminService = require('../../services/timer-admin-service');
const { success, error } = require('../../utils/apiResponse');

// GET /api/v1/admin/bookings/:id/timers — timer overview
const getTimerOverview = async (req, res, next) => {
  try {
    const data = await timerAdminService.getTimerOverview(req.params.id);
    return success(res, data, 'Timer overview');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/admin/bookings/:id/timers/:timerType/extend
const extendTimer = async (req, res, next) => {
  try {
    const result = await timerAdminService.extendTimer(
      req.params.id,
      req.params.timerType,
      Number(req.body.additionalDays),
      req.user._id.toString(),
      req.body.reason || ''
    );
    return success(res, result, 'Timer extended');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/admin/bookings/:id/timers/:timerType/reduce
const reduceTimer = async (req, res, next) => {
  try {
    const result = await timerAdminService.reduceTimer(
      req.params.id,
      req.params.timerType,
      Number(req.body.reduceDays),
      req.user._id.toString(),
      req.body.reason || ''
    );
    return success(res, result, 'Timer reduced');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/admin/bookings/:id/timers/:timerType/pause
const pauseTimer = async (req, res, next) => {
  try {
    const result = await timerAdminService.pauseTimer(
      req.params.id,
      req.params.timerType,
      req.user._id.toString(),
      req.body.reason || ''
    );
    return success(res, result, 'Timer paused');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/admin/bookings/:id/timers/:timerType/resume
const resumeTimer = async (req, res, next) => {
  try {
    const result = await timerAdminService.resumeTimer(
      req.params.id,
      req.params.timerType,
      req.user._id.toString(),
      req.body.reason || ''
    );
    return success(res, result, 'Timer resumed');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { getTimerOverview, extendTimer, reduceTimer, pauseTimer, resumeTimer };
