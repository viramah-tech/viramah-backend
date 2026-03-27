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
} = require('../../controllers/admin/depositController');

const router = express.Router();

// All admin deposit routes require admin auth
router.use(protect, authorize('admin', 'accountant'));

// ── GET /api/admin/deposits/stats ─────────────────────────────────────────────
router.get('/stats', getDepositStats);

// ── GET /api/admin/deposits ───────────────────────────────────────────────────
router.get('/', listDeposits);

// ── GET /api/admin/deposits/refund-requests ───────────────────────────────────
// Must be BEFORE /:holdId to avoid route conflict
router.get('/refund-requests', listRefundRequests);

// ── POST /api/admin/deposits/expire-holds (manual trigger for testing) ────────
// TODO: Remove this endpoint once a cron job is implemented
router.post('/expire-holds', authorize('admin'), triggerExpireHolds);

// ── PATCH /api/admin/deposits/:holdId/approve ─────────────────────────────────
router.patch(
  '/:holdId/approve',
  [
    param('holdId').isMongoId().withMessage('holdId must be a valid ID'),
  ],
  validate,
  auditLog('APPROVE_DEPOSIT', 'deposit'),
  approveDeposit
);

// ── PATCH /api/admin/deposits/refunds/:refundId/approve ──────────────────────
router.patch(
  '/refunds/:refundId/approve',
  [
    param('refundId').isMongoId().withMessage('refundId must be a valid ID'),
  ],
  validate,
  auditLog('APPROVE_REFUND', 'refund'),
  approveRefund
);

// ── PATCH /api/admin/deposits/refunds/:refundId/reject ───────────────────────
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
