const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const {
  initiatePayment,
  getMyPayments,
  getPaymentById,
} = require('../../controllers/public/paymentController');

const router = express.Router();

// All payment routes require authenticated resident
router.use(protect, authorize('user'));

// POST /api/public/payments/initiate
router.post(
  '/initiate',
  [
    body('amount')
      .isFloat({ min: 0 })
      .withMessage('Amount is required'),
    body('paymentMethod')
      .trim()
      .notEmpty()
      .withMessage('Payment method is required'),
  ],
  validate,
  initiatePayment
);

// GET /api/public/payments/my-payments
router.get('/my-payments', getMyPayments);

// GET /api/public/payments/:id
router.get('/:id', getPaymentById);

module.exports = router;
