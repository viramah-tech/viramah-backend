const express = require('express');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const {
  getPayments,
  getPaymentStats,
  getPaymentAnalytics,
  getPaymentById,
  exportPayments,
} = require('../../controllers/admin/paymentController');

const router = express.Router();

// All routes require authentication and admin role
router.use(protect, authorize('admin', 'accountant'));

// NOTE: Read-only V1 endpoints kept for FinancialReports.tsx and Transactions.tsx.
// Write operations (create / approve / reject / receipt) have been migrated to
// /api/admin/payments-v2 (paymentReviewController). Do not re-add them here.

router.get('/', getPayments);
router.get('/stats', getPaymentStats);

// Analytics must be BEFORE /:id to avoid route conflict
router.get('/analytics', getPaymentAnalytics);

// Export must be BEFORE /:id to avoid route conflicts
router.get('/export/data', exportPayments);

router.get('/:id', getPaymentById);

module.exports = router;
