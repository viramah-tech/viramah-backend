'use strict';
const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../../../middleware/validate');
const { protect } = require('../../../middleware/auth');
const { authorizeV3 } = require('../../../middleware/roleAuth');
const { auditLog } = require('../../../middleware/requestLogger');
const ctrl = require('../../../controllers/admin/bookingManagementController');

const router = express.Router();

// All booking management routes require authentication
router.use(protect);

// GET /api/v1/admin/bookings — list all bookings
// Verifiers can view (to check payment context), managers can manage
router.get('/', authorizeV3('MANAGE_BOOKINGS', 'VERIFY_PAYMENTS'), ctrl.list);

// GET /api/v1/admin/bookings/stats — booking counts by status
router.get('/stats', authorizeV3('MANAGE_BOOKINGS', 'VERIFY_PAYMENTS'), ctrl.stats);

// GET /api/v1/admin/bookings/:id — single booking detail
router.get('/:id', [param('id').isMongoId()], validate, authorizeV3('MANAGE_BOOKINGS', 'VERIFY_PAYMENTS'), ctrl.detail);

// POST /api/v1/admin/bookings/:id/force-expire — cancel/expire a booking
// Only managers and above
router.post(
  '/:id/force-expire',
  [param('id').isMongoId()],
  validate,
  authorizeV3('MANAGE_BOOKINGS'),
  auditLog('FORCE_EXPIRE_BOOKING', 'booking'),
  ctrl.forceExpire
);

// POST /api/v1/admin/bookings/:id/extend — extend final payment deadline
// Only managers and above (EXTEND_DEADLINES capability)
router.post(
  '/:id/extend',
  [
    param('id').isMongoId(),
    body('days').isInt({ min: 1, max: 30 }).withMessage('days must be 1-30'),
  ],
  validate,
  authorizeV3('EXTEND_DEADLINES'),
  auditLog('EXTEND_BOOKING_DEADLINE', 'booking'),
  ctrl.extend
);

// POST /api/v1/admin/bookings/:id/adjust-credit — adjust credit amount
// Only managers and above (ADJUST_DISCOUNTS capability)
router.post(
  '/:id/adjust-credit',
  [
    param('id').isMongoId(),
    body('amount').isNumeric().withMessage('amount is required (in INR)'),
    body('reason').trim().notEmpty().withMessage('reason is required'),
  ],
  validate,
  authorizeV3('ADJUST_DISCOUNTS'),
  auditLog('ADJUST_BOOKING_CREDIT', 'booking'),
  ctrl.adjustCredit
);

// PATCH /api/v1/admin/bookings/:id/timer — set booking timer (payment expiry or final deadline)
router.patch(
  '/:id/timer',
  [
    param('id').isMongoId(),
    body('timerType').isIn(['bookingPaymentExpiry', 'finalPaymentDeadline']).withMessage('timerType must be bookingPaymentExpiry or finalPaymentDeadline'),
    body('deadline').notEmpty().withMessage('deadline is required (ISO date string)'),
  ],
  validate,
  authorizeV3('MANAGE_BOOKINGS'),
  auditLog('SET_BOOKING_TIMER', 'booking'),
  ctrl.setTimer
);

module.exports = router;
