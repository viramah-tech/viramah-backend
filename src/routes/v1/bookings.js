'use strict';

/**
 * bookings.js — V2.0 Resident-facing booking routes.
 *
 * Endpoints:
 *   POST   /                                    — initiate booking (dual bill)
 *   GET    /my-booking                          — active booking + bills
 *   GET    /:id/bills                           — dual bill display data
 *   GET    /:id/timer                           — timer status
 *   POST   /:id/pay                             — submit booking payment proof
 *   POST   /:id/select-track                    — select FULL_TENURE / HALF_YEARLY
 *   GET    /:id/payment-page                    — payment page data with history
 *   GET    /:id/installments/:num               — installment detail
 *   POST   /:id/installments/:num/pay           — partial payment submission
 *   GET    /:id/services                        — service payment options
 *   POST   /:id/services/:type/pay              — service payment submission
 *   POST   /:id/referral                        — apply referral code
 *   POST   /:id/use-referral-credit             — use earned referral credits
 *   GET    /referral/my-code                    — get/generate referral code
 *   GET    /referral/stats                      — referral stats
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const idempotency = require('../../middleware/idempotency');

const bookingCtrl     = require('../../controllers/public/bookingController');
const installmentCtrl = require('../../controllers/public/installmentController');
const serviceCtrl     = require('../../controllers/public/servicePaymentController');
const referralCtrl    = require('../../controllers/public/referralController');

const router = express.Router();
router.use(protect, authorize('user', 'resident'));

// ── Booking Core ─────────────────────────────────────────────────────────────

// POST / — initiate booking (returns dual bill)
router.post(
  '/',
  idempotency,
  [body('roomTypeId').notEmpty().withMessage('roomTypeId is required')],
  validate,
  bookingCtrl.initiate
);

// GET /my-booking — current user's active booking
router.get('/my-booking', bookingCtrl.getMyBooking);

// GET /:id/bills — dual bill display (booking + projected final)
router.get(
  '/:id/bills',
  [param('id').isMongoId()],
  validate,
  bookingCtrl.getBills
);

// GET /:id/timer — timer status
router.get(
  '/:id/timer',
  [param('id').isMongoId()],
  validate,
  bookingCtrl.getTimer
);

// POST /:id/pay — submit booking payment proof
router.post(
  '/:id/pay',
  idempotency,
  [
    param('id').isMongoId().withMessage('Invalid booking id'),
    body('transactionId').trim().notEmpty().withMessage('transactionId required'),
    body('receiptUrl').trim().notEmpty().withMessage('receiptUrl required'),
    body('paymentMethod').optional().isIn(['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']),
  ],
  validate,
  bookingCtrl.submitPayment
);

// POST /:id/select-track — select FULL_TENURE or HALF_YEARLY
router.post(
  '/:id/select-track',
  idempotency,
  [
    param('id').isMongoId(),
    body('trackId').isIn(['FULL_TENURE', 'HALF_YEARLY']).withMessage('trackId must be FULL_TENURE or HALF_YEARLY'),
  ],
  validate,
  bookingCtrl.selectTrack
);

// GET /:id/payment-page — full payment page data with embedded history
router.get(
  '/:id/payment-page',
  [
    param('id').isMongoId(),
    query('installment').optional().isInt({ min: 1, max: 2 }),
  ],
  validate,
  bookingCtrl.getPaymentPage
);

// ── Installment Payments ─────────────────────────────────────────────────────

// GET /:id/installments/:installmentNumber — installment detail + history
router.get(
  '/:id/installments/:installmentNumber',
  [
    param('id').isMongoId(),
    param('installmentNumber').isInt({ min: 1, max: 2 }),
  ],
  validate,
  installmentCtrl.getInstallmentData
);

// POST /:id/installments/:installmentNumber/pay — partial payment
router.post(
  '/:id/installments/:installmentNumber/pay',
  idempotency,
  [
    param('id').isMongoId(),
    param('installmentNumber').isInt({ min: 1, max: 2 }),
    body('amount').isFloat({ min: 1000 }).withMessage('Minimum payment is ₹1,000'),
    body('receiptUrl').optional().isString(),
    body('utrNumber').optional().isString(),
    body('paymentMethod').optional().isIn(['UPI', 'BANK_TRANSFER', 'CASH']),
  ],
  validate,
  installmentCtrl.submitPartialPayment
);

// ── Service Payments (Mess / Transport) ──────────────────────────────────────

// GET /:id/services — available service payment options
router.get(
  '/:id/services',
  [param('id').isMongoId()],
  validate,
  serviceCtrl.getServices
);

// POST /:id/services/:serviceType/pay — submit service payment
router.post(
  '/:id/services/:serviceType/pay',
  idempotency,
  [
    param('id').isMongoId(),
    param('serviceType').isIn(['mess', 'transport', 'MESS', 'TRANSPORT']),
    body('amount').isFloat({ min: 500 }).withMessage('Minimum service payment is ₹500'),
    body('receiptUrl').optional().isString(),
    body('utrNumber').optional().isString(),
    body('paymentMethod').optional().isIn(['UPI', 'BANK_TRANSFER', 'CASH']),
  ],
  validate,
  serviceCtrl.submitServicePayment
);

// ── Referral System ──────────────────────────────────────────────────────────

// GET /referral/my-code — get or generate referral code
router.get('/referral/my-code', referralCtrl.getMyCode);

// GET /referral/stats — referral stats
router.get('/referral/stats', referralCtrl.getStats);

// POST /:id/referral — apply referral code to booking
router.post(
  '/:id/referral',
  [
    param('id').isMongoId(),
    body('referralCode').trim().notEmpty().withMessage('Referral code is required'),
  ],
  validate,
  referralCtrl.applyReferral
);

// POST /:id/use-referral-credit — use earned referral credits
router.post(
  '/:id/use-referral-credit',
  [param('id').isMongoId()],
  validate,
  referralCtrl.useCredit
);

module.exports = router;
