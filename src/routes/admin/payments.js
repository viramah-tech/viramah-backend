const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const { auditLog } = require('../../middleware/requestLogger');
const {
  getPayments,
  getPaymentStats,
  getPaymentById,
  createPayment,
  approvePayment,
  rejectPayment,
  attachReceipt,
  exportPayments,
} = require('../../controllers/admin/paymentController');

const router = express.Router();

// All routes require authentication and admin role
router.use(protect, authorize('admin'));

router.get('/', getPayments);
router.get('/stats', getPaymentStats);

// Export must be BEFORE /:id to avoid route conflicts
router.get('/export/data', exportPayments);

router.get('/:id', getPaymentById);

router.post(
  '/',
  [
    body('userId').trim().notEmpty().withMessage('User ID is required'),
    body('amount')
      .isNumeric()
      .withMessage('Amount must be a number')
      .custom((value) => value > 0)
      .withMessage('Amount must be greater than 0'),
  ],
  validate,
  createPayment
);

router.patch('/:id/approve', auditLog('APPROVE_PAYMENT', 'payment'), approvePayment);
router.patch('/:id/reject', auditLog('REJECT_PAYMENT', 'payment'), rejectPayment);

// PATCH /:id/receipt - Attach receipt URL to payment
router.patch(
  '/:id/receipt',
  [body('receiptUrl').trim().notEmpty().withMessage('Receipt URL is required')],
  validate,
  attachReceipt
);

module.exports = router;
