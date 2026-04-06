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
router.get('/:paymentId', ctrl.detail);

router.post('/:paymentId/approve',
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

module.exports = router;
