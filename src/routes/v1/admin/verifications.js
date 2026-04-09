'use strict';
const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../../../middleware/validate');
const { protect } = require('../../../middleware/auth');
const { authorize } = require('../../../middleware/roleAuth');
const { auditLog } = require('../../../middleware/requestLogger');
const ctrl = require('../../../controllers/admin/verificationController');

const router = express.Router();
router.use(protect, authorize('admin', 'accountant'));

// GET /api/v1/admin/verifications — list pending queue with risk scores
router.get('/', ctrl.list);

// GET /api/v1/admin/verifications/stats — queue statistics
router.get('/stats', ctrl.stats);

// GET /api/v1/admin/verifications/:id — single verification detail (ocrData, riskScore, flags)
router.get('/:id', [param('id').isMongoId()], validate, ctrl.detail);

// POST /api/v1/admin/verifications/:id/approve — approve booking payment + start 7-day timer
router.post(
  '/:id/approve',
  [param('id').isMongoId()],
  validate,
  auditLog('APPROVE_BOOKING_V3', 'payment'),
  ctrl.approveBooking
);

// POST /api/v1/admin/verifications/:id/reject
router.post(
  '/:id/reject',
  [param('id').isMongoId(), body('reason').trim().notEmpty().withMessage('reason required')],
  validate,
  auditLog('REJECT_BOOKING_V3', 'payment'),
  ctrl.reject
);

// POST /api/v1/admin/verifications/:id/hold
router.post(
  '/:id/hold',
  [param('id').isMongoId(), body('reason').trim().notEmpty().withMessage('reason required')],
  validate,
  ctrl.hold
);

module.exports = router;
