'use strict';

const planService = require('../../services/payment-plan-service');
const { success, error } = require('../../utils/apiResponse');

const getConfig = async (req, res, next) => {
  try {
    return success(res, await planService.getConfig(), 'Payment config');
  } catch (e) { next(e); }
};

const selectTrack = async (req, res, next) => {
  try {
    const { trackId, addOns, bookingId } = req.body;
    let plan;
    if (bookingId) {
      // V3 path: track selection after booking confirmation
      const result = await planService.selectTrackPostBooking(req.user._id, bookingId, {
        trackId,
        addOns: addOns || {},
      });
      plan = result.plan;
    } else {
      // V2 legacy path
      plan = await planService.selectTrack(req.user._id, {
        trackId,
        addOns: addOns || {},
      });
    }
    return success(res, { plan }, 'Track selected', 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const createBookingPlan = async (req, res, next) => {
  try {
    const plan = await planService.createBookingPlan(req.user._id, {
      addOns:  req.body.addOns || {},
      advance: Number(req.body.advance) || 0,
    });
    return success(res, { plan }, 'Booking plan created', 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const upgradeTrack = async (req, res, next) => {
  try {
    const plan = await planService.upgradeTrack(req.user._id, { trackId: req.body.trackId });
    return success(res, { plan }, 'Plan upgraded');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const getMyPlan = async (req, res, next) => {
  try {
    const plan = await planService.getMyPlan(req.user._id);
    return success(res, { plan }, 'Current plan');
  } catch (e) { next(e); }
};

const getPhaseBreakdown = async (req, res, next) => {
  try {
    const phase = req.query.phase || 1;
    const computed = await planService.getPhaseBreakdown(req.user._id, req.params.planId, phase);
    return success(res, { breakdown: computed }, 'Phase breakdown');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = {
  getConfig,
  selectTrack,
  createBookingPlan,
  upgradeTrack,
  getMyPlan,
  getPhaseBreakdown,
};
