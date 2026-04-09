'use strict';

/**
 * V2 admin payment review routes — plan Section 4.4.
 * Mounted at /api/admin/payments-v2 to avoid colliding with the legacy
 * /api/admin/payments router during transition.
 */

const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const { auditLog } = require('../../middleware/requestLogger');
const ctrl = require('../../controllers/admin/paymentReviewController');

const router = express.Router();
router.use(protect, authorize('admin', 'accountant'));

router.get('/', ctrl.list);
router.get('/stats', ctrl.unifiedStats);

// Bulk operations (before :paymentId wildcard)
router.post('/bulk-approve',
  [body('paymentIds').isArray({ min: 1, max: 50 }).withMessage('paymentIds must be an array of 1-50 items')],
  validate,
  auditLog('BULK_APPROVE_PAYMENT', 'payment'),
  ctrl.bulkApprove
);

router.post('/bulk-reject',
  [
    body('paymentIds').isArray({ min: 1, max: 50 }).withMessage('paymentIds must be an array of 1-50 items'),
    body('reason').trim().notEmpty().withMessage('reason is required'),
  ],
  validate,
  auditLog('BULK_REJECT_PAYMENT', 'payment'),
  ctrl.bulkReject
);

router.post('/manual',
  [
    body('userId').notEmpty(),
    body('amount').isNumeric().custom((v) => v > 0),
    body('transactionId').trim().notEmpty(),
    body('receiptUrl').trim().notEmpty(),
    body('paymentMethod').isIn(['UPI','NEFT','RTGS','IMPS','CASH','CHEQUE','OTHER']),
  ],
  validate,
  ctrl.manual
);

router.get('/:paymentId', ctrl.detail);

router.post('/:paymentId/approve',
  [body('type').optional().isIn(['booking', 'final']).withMessage('type must be booking or final')],
  validate,
  auditLog('APPROVE_PAYMENT_V2', 'payment'),
  ctrl.approve
);

router.post('/:paymentId/reject',
  [body('reason').trim().notEmpty().withMessage('reason is required')],
  validate,
  auditLog('REJECT_PAYMENT_V2', 'payment'),
  ctrl.reject
);

router.post('/:paymentId/hold',
  [body('reason').trim().notEmpty().withMessage('reason is required')],
  validate,
  ctrl.hold
);

module.exports = router;
