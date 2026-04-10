'use strict';

/**
 * admin/discounts.js — V2.0 Admin discount management routes.
 *
 * Endpoints:
 *   POST   /users/:userId/discounts         — set user discount override
 *   GET    /users/:userId/discounts         — get discount audit for user
 *   POST   /bookings/:id/discounts          — set booking discount override
 *   GET    /bookings/:id/discounts/effective — get effective discount
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { validate } = require('../../../middleware/validate');
const { protect } = require('../../../middleware/auth');
const { authorizeV3 } = require('../../../middleware/roleAuth');
const { auditLog } = require('../../../middleware/requestLogger');
const ctrl = require('../../../controllers/admin/discountAdminController');

const router = express.Router();
router.use(protect);

// POST /users/:userId/discounts — set user discount override
router.post(
  '/users/:userId/discounts',
  [
    param('userId').isMongoId(),
    body('fullTenurePercent').optional().isFloat({ min: 0, max: 50 }).withMessage('Max 50%'),
    body('halfYearlyPercent').optional().isFloat({ min: 0, max: 35 }).withMessage('Max 35%'),
    body('validUntil').optional().isISO8601(),
    body('reason').optional().isString(),
  ],
  validate,
  authorizeV3('ADJUST_DISCOUNTS'),
  auditLog('SET_USER_DISCOUNT', 'user'),
  ctrl.setUserDiscount
);

// GET /users/:userId/discounts — discount audit for user
router.get(
  '/users/:userId/discounts',
  [param('userId').isMongoId()],
  validate,
  authorizeV3('ADJUST_DISCOUNTS', 'MANAGE_BOOKINGS'),
  ctrl.getDiscountAudit
);

// POST /bookings/:id/discounts — set booking discount override
router.post(
  '/bookings/:id/discounts',
  [
    param('id').isMongoId(),
    body('fullTenurePercent').optional().isFloat({ min: 0, max: 50 }),
    body('halfYearlyPercent').optional().isFloat({ min: 0, max: 35 }),
    body('messDiscountPercent').optional().isFloat({ min: 0, max: 50 }),
    body('transportDiscountPercent').optional().isFloat({ min: 0, max: 50 }),
    body('validUntil').optional().isISO8601(),
  ],
  validate,
  authorizeV3('ADJUST_DISCOUNTS'),
  auditLog('SET_BOOKING_DISCOUNT', 'booking'),
  ctrl.setBookingDiscount
);

// GET /bookings/:id/discounts/effective — get effective discount with source
router.get(
  '/bookings/:id/discounts/effective',
  [
    param('id').isMongoId(),
    query('track').optional().isIn(['FULL_TENURE', 'HALF_YEARLY']),
  ],
  validate,
  authorizeV3('ADJUST_DISCOUNTS', 'MANAGE_BOOKINGS'),
  ctrl.getEffective
);

module.exports = router;
