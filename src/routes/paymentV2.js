'use strict';

/**
 * Router mounted at `/api/payment` — V2 payment flow (plan Section 4.1–4.2).
 * Kept separate from legacy `/api/public/payments` during transition.
 */

const express = require('express');
const multer  = require('multer');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/roleAuth');
const ctrl       = require('../controllers/public/paymentPlanController');
const submitCtrl = require('../controllers/public/paymentSubmitController');
const { createS3Storage, getFileUrl, fileFilter } = require('../services/s3Service');
const { success, error } = require('../utils/apiResponse');

const router = express.Router();

const uploadReceipt = multer({
  storage: createS3Storage('receipts'),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

// Public (no auth) — discount/track display
router.get('/config', ctrl.getConfig);

// Protected — resident only
router.use(protect, authorize('user', 'resident'));

router.post('/plan/select-track',
  [body('trackId').isIn(['full', 'twopart']).withMessage('trackId must be full or twopart')],
  validate,
  ctrl.selectTrack
);

router.post('/plan/booking',
  [body('advance').optional().isNumeric()],
  validate,
  ctrl.createBookingPlan
);

router.post('/plan/upgrade-track',
  [body('trackId').isIn(['full', 'twopart']).withMessage('trackId must be full or twopart')],
  validate,
  ctrl.upgradeTrack
);

router.get('/plan/me', ctrl.getMyPlan);
router.get('/plan/:planId/breakdown', ctrl.getPhaseBreakdown);

// ── Payment submission (Section 4.2) ─────────────────────────────────────────

// Two-step receipt upload: client uploads file → gets URL → includes in submit
router.post('/upload-receipt', uploadReceipt.single('receipt'), (req, res) => {
  if (!req.file) return error(res, 'No file uploaded', 400);
  return success(res, {
    url:  getFileUrl(req.file.key),
    key:  req.file.key,
    size: req.file.size,
  }, 'Receipt uploaded');
});

router.post('/submit',
  [
    body('planId').notEmpty().withMessage('planId is required'),
    body('transactionId').trim().notEmpty().withMessage('transactionId is required'),
    body('receiptUrl').trim().notEmpty().withMessage('receiptUrl is required'),
    body('paymentMethod')
      .isIn(['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'OTHER'])
      .withMessage('paymentMethod must be one of UPI, NEFT, RTGS, IMPS, CASH, CHEQUE, OTHER'),
  ],
  validate,
  submitCtrl.submit
);

router.get('/history', submitCtrl.history);
router.get('/:paymentId', submitCtrl.single);

// Multer error handler — must be after routes that use it
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return error(res, 'File too large. Maximum size is 10MB', 400);
    return error(res, err.message, 400);
  }
  if (err.message && err.message.includes('Only images')) return error(res, err.message, 400);
  next(err);
});

module.exports = router;
