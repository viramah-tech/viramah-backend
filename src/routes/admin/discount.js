'use strict';

/**
 * Admin discount management routes — plan Section 4.3.
 * Mounted at /api/admin/discount-config and /api/admin/adjustments/discount-override.
 */

const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const ctrl = require('../../controllers/admin/discountController');

const router = express.Router();
router.use(protect, authorize('admin', 'accountant'));

// /api/admin/discount-config
router.get('/discount-config', ctrl.list);
router.patch('/discount-config/:trackId',
  [
    body('newRate').optional().isFloat({ min: 0, max: 1 }),
    body('isActive').optional().isBoolean(),
    body('reason').trim().notEmpty().withMessage('reason is required'),
  ],
  validate,
  ctrl.update
);
router.get('/discount-config/:trackId/history', ctrl.history);

// /api/admin/adjustments/discount-override
router.post('/adjustments/discount-override',
  [
    body('userId').notEmpty(),
    body('newDiscountRate').isFloat({ min: 0, max: 1 }),
    body('reason').trim().notEmpty(),
  ],
  validate,
  ctrl.setOverride
);
router.delete('/adjustments/discount-override/:userId', ctrl.removeOverride);

module.exports = router;
