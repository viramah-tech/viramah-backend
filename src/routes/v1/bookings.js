'use strict';
const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const idempotency = require('../../middleware/idempotency');
const ctrl = require('../../controllers/public/bookingController');

const router = express.Router();
router.use(protect, authorize('user', 'resident'));

// POST /api/v1/bookings — initiate booking (idempotent)
router.post(
  '/',
  idempotency,
  [body('roomTypeId').notEmpty().withMessage('roomTypeId is required')],
  validate,
  ctrl.initiate
);

// GET /api/v1/bookings/my-booking — current user's active booking
router.get('/my-booking', ctrl.getMyBooking);

// GET /api/v1/bookings/:id/timer — price lock / payment deadline timers
router.get('/:id/timer', [param('id').isMongoId()], validate, ctrl.getTimer);

// POST /api/v1/bookings/:id/pay — submit booking payment proof
router.post(
  '/:id/pay',
  idempotency,
  [
    param('id').isMongoId().withMessage('Invalid booking id'),
    body('transactionId').trim().notEmpty().withMessage('transactionId required'),
    body('receiptUrl').trim().notEmpty().withMessage('receiptUrl required'),
    body('paymentMethod').optional().isIn(['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'OTHER']),
  ],
  validate,
  ctrl.submitPayment
);

module.exports = router;
