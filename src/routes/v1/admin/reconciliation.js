'use strict';
const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../../../middleware/validate');
const { protect } = require('../../../middleware/auth');
const { authorizeV3 } = require('../../../middleware/roleAuth');
const { auditLog } = require('../../../middleware/requestLogger');
const ctrl = require('../../../controllers/admin/reconciliationController');

const router = express.Router();

// All reconciliation routes require authentication
router.use(protect);

// GET /api/v1/admin/reconciliation/stats — match/mismatch/unreconciled counts
router.get('/stats', authorizeV3('VIEW_RECONCILIATION'), ctrl.stats);

// GET /api/v1/admin/reconciliation — list by reconciliation status
router.get('/', authorizeV3('VIEW_RECONCILIATION'), ctrl.list);

// POST /api/v1/admin/reconciliation/upload — process bank statement
// Only accountants (verifiers) and managers can upload
router.post(
  '/upload',
  [body('transactions').isArray({ min: 1 }).withMessage('transactions must be a non-empty array')],
  validate,
  authorizeV3('UPLOAD_STATEMENTS'),
  auditLog('UPLOAD_BANK_STATEMENT', 'reconciliation'),
  ctrl.uploadStatement
);

// POST /api/v1/admin/reconciliation/:id/resolve — resolve discrepancy
// Only managers and above can resolve discrepancies
router.post(
  '/:id/resolve',
  [
    param('id').isMongoId(),
    body('resolution').trim().notEmpty().withMessage('resolution is required'),
  ],
  validate,
  authorizeV3('MANAGE_BOOKINGS'),
  auditLog('RESOLVE_DISCREPANCY', 'reconciliation'),
  ctrl.resolve
);

module.exports = router;
