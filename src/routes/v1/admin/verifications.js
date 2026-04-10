'use strict';
const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../../../middleware/validate');
const { protect } = require('../../../middleware/auth');
const { authorizeV3 } = require('../../../middleware/roleAuth');
const { auditLog } = require('../../../middleware/requestLogger');
const ctrl = require('../../../controllers/admin/verificationController');

const router = express.Router();

// All verification routes require authentication
router.use(protect);

// GET /api/v1/admin/verifications — list pending queue with risk scores
// Accessible by verifiers and managers
router.get('/', authorizeV3('VERIFY_PAYMENTS', 'MANAGE_BOOKINGS'), ctrl.list);

// GET /api/v1/admin/verifications/stats — queue statistics
router.get('/stats', authorizeV3('VERIFY_PAYMENTS', 'MANAGE_BOOKINGS'), ctrl.stats);

// GET /api/v1/admin/verifications/:id — single verification detail (ocrData, riskScore, flags)
router.get('/:id', [param('id').isMongoId()], validate, authorizeV3('VERIFY_PAYMENTS'), ctrl.detail);

// POST /api/v1/admin/verifications/:id/approve — approve booking payment + start 7-day timer
// Only verifiers (accountant) and above can approve
router.post(
  '/:id/approve',
  [param('id').isMongoId()],
  validate,
  authorizeV3('VERIFY_PAYMENTS'),
  auditLog('APPROVE_BOOKING_V3', 'payment'),
  ctrl.approveBooking
);

// POST /api/v1/admin/verifications/:id/reject
router.post(
  '/:id/reject',
  [param('id').isMongoId(), body('reason').trim().notEmpty().withMessage('reason required')],
  validate,
  authorizeV3('VERIFY_PAYMENTS'),
  auditLog('REJECT_BOOKING_V3', 'payment'),
  ctrl.reject
);

// POST /api/v1/admin/verifications/:id/hold
router.post(
  '/:id/hold',
  [param('id').isMongoId(), body('reason').trim().notEmpty().withMessage('reason required')],
  validate,
  authorizeV3('VERIFY_PAYMENTS'),
  ctrl.hold
);

module.exports = router;
