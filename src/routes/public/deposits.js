'use strict';

const express    = require('express');
const { body, param } = require('express-validator');
const { validate }   = require('../../middleware/validate');
const { protect }    = require('../../middleware/auth');
const { authorize }  = require('../../middleware/roleAuth');
const {
  initiateDeposit,
  getDepositStatus,
  requestRefund,
} = require('../../controllers/public/depositController');

const router = express.Router();

// All deposit routes require resident auth
router.use(protect, authorize('user', 'resident'));

// ── POST /api/public/deposits/initiate ────────────────────────────────────────
router.post(
  '/initiate',
  [
    body('roomTypeId')
      .trim()
      .notEmpty()
      .withMessage('roomTypeId is required')
      .isMongoId()
      .withMessage('roomTypeId must be a valid ID'),
    body('transactionId')
      .trim()
      .notEmpty()
      .withMessage('transactionId is required'),
    body('receiptUrl')
      .optional({ nullable: true })
      .trim()
      .isURL()
      .withMessage('receiptUrl must be a valid URL'),
  ],
  validate,
  initiateDeposit
);

// ── GET /api/public/deposits/status ───────────────────────────────────────────
router.get('/status', getDepositStatus);

// ── POST /api/public/deposits/request-refund ──────────────────────────────────
router.post(
  '/request-refund',
  [
    body('reason')
      .optional({ nullable: true })
      .trim()
      .isLength({ max: 500 })
      .withMessage('Reason must be 500 characters or fewer'),
  ],
  validate,
  requestRefund
);

module.exports = router;
