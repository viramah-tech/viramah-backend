'use strict';

const express    = require('express');
const { param, body } = require('express-validator');
const { validate }    = require('../../middleware/validate');
const { protect }     = require('../../middleware/auth');
const { authorize }   = require('../../middleware/roleAuth');
const { auditLog }    = require('../../middleware/requestLogger');
const {
  listDeposits,
  getDepositStats,
  approveDeposit,
  listRefundRequests,
  approveRefund,
  rejectRefund,
  triggerExpireHolds,
  adminCreateDeposit,
  extendDeadline,
  forceExpireHold,
  getFinancialSummary,
} = require('../../controllers/admin/depositController');

const router = express.Router();

// All admin deposit routes require admin auth
router.use(protect, authorize('admin', 'accountant'));

// ── Static routes (BEFORE :holdId wildcard) ──────────────────────────────────
router.get('/stats', getDepositStats);
router.get('/financial-summary', getFinancialSummary);
router.get('/', listDeposits);
router.get('/refund-requests', listRefundRequests);

// Admin-only actions
router.post('/expire-holds', authorize('admin'), triggerExpireHolds);
router.post('/create',
  [
    body('userId').trim().notEmpty().withMessage('userId is required'),
    body('roomTypeId').trim().notEmpty().withMessage('roomTypeId is required'),
    body('paymentMode').isIn(['full', 'half', 'deposit']).withMessage('paymentMode must be full, half, or deposit'),
  ],
  validate,
  auditLog('ADMIN_CREATE_DEPOSIT', 'deposit'),
  adminCreateDeposit
);

// ── Parameterized routes ─────────────────────────────────────────────────────
router.patch(
  '/:holdId/approve',
  [param('holdId').isMongoId().withMessage('holdId must be a valid ID')],
  validate,
  auditLog('APPROVE_DEPOSIT', 'deposit'),
  approveDeposit
);

router.patch(
  '/:holdId/extend-deadline',
  [
    param('holdId').isMongoId().withMessage('holdId must be a valid ID'),
    body('reason').trim().notEmpty().isLength({ min: 5 }).withMessage('reason is required (min 5 chars)'),
  ],
  validate,
  auditLog('EXTEND_DEADLINE', 'deposit'),
  extendDeadline
);

router.patch(
  '/:holdId/force-expire',
  [
    param('holdId').isMongoId().withMessage('holdId must be a valid ID'),
    body('reason').trim().notEmpty().isLength({ min: 5 }).withMessage('reason is required (min 5 chars)'),
  ],
  validate,
  authorize('admin'),
  auditLog('FORCE_EXPIRE_HOLD', 'deposit'),
  forceExpireHold
);

// ── Refund actions ───────────────────────────────────────────────────────────
router.patch(
  '/refunds/:refundId/approve',
  [param('refundId').isMongoId().withMessage('refundId must be a valid ID')],
  validate,
  auditLog('APPROVE_REFUND', 'refund'),
  approveRefund
);

router.patch(
  '/refunds/:refundId/reject',
  [
    param('refundId').isMongoId().withMessage('refundId must be a valid ID'),
    body('reason').optional({ nullable: true }).trim().isLength({ max: 500 }),
  ],
  validate,
  auditLog('REJECT_REFUND', 'refund'),
  rejectRefund
);

module.exports = router;

