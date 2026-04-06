'use strict';

/**
 * Admin payment plan management — plan Section 4.5.
 * Mounted at /api/admin/payment-plans and /api/admin/adjustments/...
 */

const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const ctrl = require('../../controllers/admin/planAdminController');

const router = express.Router();
router.use(protect, authorize('admin', 'accountant'));

// /api/admin/payment-plans
router.get('/payment-plans', ctrl.list);
router.get('/payment-plans/:planId', ctrl.detail);

router.patch('/payment-plans/:planId/phase2-date',
  [body('dueDate').optional({ nullable: true })],
  validate,
  ctrl.setPhase2Date
);

router.post('/payment-plans/:planId/hold-phase',
  [
    body('phaseNumber').isInt({ min: 1, max: 2 }),
    body('reason').trim().notEmpty(),
  ],
  validate,
  ctrl.holdPhase
);

router.post('/payment-plans/:planId/unlock-phase',
  [body('phaseNumber').isInt({ min: 1, max: 2 })],
  validate,
  ctrl.unlockPhase
);

// /api/admin/adjustments
router.post('/adjustments/custom-charge',
  [
    body('userId').notEmpty(),
    body('planId').notEmpty(),
    body('valueType').isIn(['flat', 'percentage']),
    body('value').isNumeric(),
    body('description').trim().notEmpty(),
    body('reason').trim().notEmpty(),
  ],
  validate,
  ctrl.customCharge
);

router.post('/adjustments/waiver',
  [
    body('userId').notEmpty(),
    body('planId').notEmpty(),
    body('value').isNumeric(),
    body('reason').trim().notEmpty(),
  ],
  validate,
  ctrl.waiver
);

module.exports = router;
