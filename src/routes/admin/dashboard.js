const express = require('express');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const {
  getOverview,
  getFinancialSummary,
  getRecentActivity,
} = require('../../controllers/admin/dashboardController');

const router = express.Router();

// All routes require authentication and admin or accountant role
router.use(protect, authorize('admin', 'accountant'));

router.get('/overview', getOverview);
router.get('/financial-summary', getFinancialSummary);
router.get('/recent-activity', getRecentActivity);

module.exports = router;
