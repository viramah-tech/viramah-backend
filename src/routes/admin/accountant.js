'use strict';

/**
 * Accountant financial dashboard — plan Section 4.6.
 * Mounted at /api/admin/accountant
 */

const express = require('express');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const ctrl = require('../../controllers/admin/accountantController');

const router = express.Router();
router.use(protect, authorize('admin', 'accountant'));

router.get('/summary',         ctrl.summary);
router.get('/overdue',         ctrl.overdue);
router.get('/ledger',          ctrl.ledger);
router.get('/discount-impact', ctrl.discountImpact);
router.get('/adjustments',     ctrl.adjustments);
router.get('/ledger/:userId',  ctrl.userLedger);
router.get('/aging',           ctrl.aging);
router.get('/cashflow',        ctrl.cashFlow);
router.get('/deposit-pipeline', ctrl.depositPipeline);
router.get('/revenue-breakdown', ctrl.revenueBreakdown);

module.exports = router;
