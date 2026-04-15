'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../../middleware/auth');
const { downloadReceipt } = require('../../controllers/public/receiptsController');

const router = express.Router();

// Rate-limit to prevent ObjectId enumeration
const receiptLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { success: false, message: 'Too many receipt requests' },
});

router.get('/:paymentId.pdf', protect, receiptLimiter, downloadReceipt);

module.exports = router;
