'use strict';

/**
 * admin/timers.js — V2.0 Admin timer control routes.
 *
 * Endpoints:
 *   GET    /bookings/:id/timers                            — timer overview
 *   POST   /bookings/:id/timers/:timerType/extend          — extend timer
 *   POST   /bookings/:id/timers/:timerType/reduce          — reduce timer
 *   POST   /bookings/:id/timers/:timerType/pause           — pause timer
 *   POST   /bookings/:id/timers/:timerType/resume          — resume timer
 */

const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../../../middleware/validate');
const { protect } = require('../../../middleware/auth');
const { authorizeV3 } = require('../../../middleware/roleAuth');
const { auditLog } = require('../../../middleware/requestLogger');
const ctrl = require('../../../controllers/admin/timerAdminController');

const router = express.Router();
router.use(protect);

const VALID_TIMERS = ['finalPaymentDeadline', 'bookingPaymentExpiry', 'priceLockExpiry'];

// GET /:id/timers — full timer overview with audit trail
router.get(
  '/:id/timers',
  [param('id').isMongoId()],
  validate,
  authorizeV3('MANAGE_BOOKINGS', 'EXTEND_DEADLINES'),
  ctrl.getTimerOverview
);

// POST /:id/timers/:timerType/extend
router.post(
  '/:id/timers/:timerType/extend',
  [
    param('id').isMongoId(),
    param('timerType').isIn(VALID_TIMERS).withMessage('Invalid timer type'),
    body('additionalDays').isInt({ min: 1, max: 14 }).withMessage('Days must be 1-14'),
    body('reason').optional().isString(),
  ],
  validate,
  authorizeV3('EXTEND_DEADLINES'),
  auditLog('EXTEND_TIMER', 'booking'),
  ctrl.extendTimer
);

// POST /:id/timers/:timerType/reduce
router.post(
  '/:id/timers/:timerType/reduce',
  [
    param('id').isMongoId(),
    param('timerType').isIn(VALID_TIMERS).withMessage('Invalid timer type'),
    body('reduceDays').isInt({ min: 1, max: 14 }).withMessage('Days must be 1-14'),
    body('reason').optional().isString(),
  ],
  validate,
  authorizeV3('EXTEND_DEADLINES'),
  auditLog('REDUCE_TIMER', 'booking'),
  ctrl.reduceTimer
);

// POST /:id/timers/:timerType/pause
router.post(
  '/:id/timers/:timerType/pause',
  [
    param('id').isMongoId(),
    param('timerType').isIn(VALID_TIMERS).withMessage('Invalid timer type'),
    body('reason').trim().notEmpty().withMessage('Reason required for pause'),
  ],
  validate,
  authorizeV3('EXTEND_DEADLINES'),
  auditLog('PAUSE_TIMER', 'booking'),
  ctrl.pauseTimer
);

// POST /:id/timers/:timerType/resume
router.post(
  '/:id/timers/:timerType/resume',
  [
    param('id').isMongoId(),
    param('timerType').isIn(VALID_TIMERS).withMessage('Invalid timer type'),
    body('reason').optional().isString(),
  ],
  validate,
  authorizeV3('EXTEND_DEADLINES'),
  auditLog('RESUME_TIMER', 'booking'),
  ctrl.resumeTimer
);

module.exports = router;
