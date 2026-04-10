'use strict';

/**
 * referralController.js — V2.0 Referral system endpoints.
 */

const referralService = require('../../services/referralService');
const { success, error } = require('../../utils/apiResponse');

// POST /api/v1/bookings/:id/referral — apply referral code
const applyReferral = async (req, res, next) => {
  try {
    const { referralCode } = req.body;
    if (!referralCode) return error(res, 'Referral code is required', 400);

    const result = await referralService.applyReferral(req.params.id, referralCode);
    return success(res, result, 'Referral code applied');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/bookings/:id/use-referral-credit — use earned referral credits
const useCredit = async (req, res, next) => {
  try {
    const result = await referralService.useReferralCredit(req.user._id, req.params.id);
    return success(res, result, 'Referral credit applied');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// GET /api/v1/referral/my-code — get/generate referral code
const getMyCode = async (req, res, next) => {
  try {
    const result = await referralService.generateReferralCode(req.user._id);
    return success(res, result, 'Referral code');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// GET /api/v1/referral/stats — referral stats
const getStats = async (req, res, next) => {
  try {
    const result = await referralService.getReferralStats(req.user._id);
    return success(res, result, 'Referral stats');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { applyReferral, useCredit, getMyCode, getStats };
