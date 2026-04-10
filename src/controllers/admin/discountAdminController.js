'use strict';

/**
 * discountAdminController.js — V2.0 Admin discount management endpoints.
 */

const discountAdminService = require('../../services/discountAdminService');
const { success, error } = require('../../utils/apiResponse');

// POST /api/v1/admin/users/:userId/discounts — set user discount override
const setUserDiscount = async (req, res, next) => {
  try {
    const result = await discountAdminService.setUserDiscount(
      req.params.userId,
      {
        fullTenurePercent:  req.body.fullTenurePercent,
        halfYearlyPercent:  req.body.halfYearlyPercent,
        validUntil:         req.body.validUntil,
        reason:             req.body.reason,
      },
      req.user._id.toString()
    );
    return success(res, result, 'User discount set');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/admin/bookings/:id/discounts — set booking discount override
const setBookingDiscount = async (req, res, next) => {
  try {
    const result = await discountAdminService.setBookingDiscount(
      req.params.id,
      {
        fullTenurePercent:      req.body.fullTenurePercent,
        halfYearlyPercent:      req.body.halfYearlyPercent,
        messDiscountPercent:    req.body.messDiscountPercent,
        transportDiscountPercent: req.body.transportDiscountPercent,
        validUntil:             req.body.validUntil,
      },
      req.user._id.toString()
    );
    return success(res, result, 'Booking discount set');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// GET /api/v1/admin/users/:userId/discounts — get discount audit for user
const getDiscountAudit = async (req, res, next) => {
  try {
    const data = await discountAdminService.getDiscountAudit(req.params.userId);
    return success(res, data, 'Discount audit');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// GET /api/v1/admin/bookings/:id/discounts/effective — get effective discount
const getEffective = async (req, res, next) => {
  try {
    const trackType = req.query.track || 'FULL_TENURE';
    const data = await discountAdminService.getEffectiveDiscount(req.params.id, trackType);
    return success(res, data, 'Effective discount');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { setUserDiscount, setBookingDiscount, getDiscountAudit, getEffective };
