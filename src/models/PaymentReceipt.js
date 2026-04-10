'use strict';

/**
 * PaymentReceipt.js — V2.0 Cash receipt tracking.
 *
 * Handles physical receipt verification for cash payments.
 * Links to Payment via paymentId.
 *
 * ALL monetary values in RUPEES (INR).
 */

const mongoose = require('mongoose');

const denominationSchema = new mongoose.Schema(
  {
    denomination: { type: Number, required: true },  // 2000, 500, 200, 100, etc.
    count:        { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const paymentReceiptSchema = new mongoose.Schema(
  {
    receiptId: {
      type: String,
      unique: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: [true, 'Payment reference is required'],
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },

    // Cash payment details
    cashDetails: {
      receiptNumber:      { type: String, required: true },  // Physical receipt book number
      receivedBy:         { type: String, required: true },   // Admin who collected
      collectionLocation: { type: String, default: '' },
      collectionDate:     { type: Date, required: true },
      amount:             { type: Number, required: true },   // rupees
      denominationBreakdown: [denominationSchema],
    },

    // Verification
    verificationStatus: {
      type: String,
      enum: ['PENDING_PHYSICAL_VERIFICATION', 'VERIFIED', 'DISCREPANCY_FOUND'],
      default: 'PENDING_PHYSICAL_VERIFICATION',
    },

    // Reconciliation with cash register
    reconciliation: {
      cashRegisterId:  { type: String, default: null },
      verifiedBy:      { type: String, default: null },
      verifiedAt:      { type: Date, default: null },
      discrepancyNotes: { type: String, default: null },
      discrepancyAmount: { type: Number, default: null },  // rupees
    },

    // Audit
    statusHistory: [{
      status:    { type: String },
      timestamp: { type: Date, default: Date.now },
      changedBy: { type: String },
      reason:    { type: String, default: '' },
    }],
  },
  {
    timestamps: true,
    collection: 'PaymentReceipts',
  }
);

// Auto-generate receiptId
paymentReceiptSchema.pre('save', function () {
  if (!this.receiptId) {
    const year = new Date().getFullYear();
    const rand = Math.floor(100000 + Math.random() * 900000);
    this.receiptId = `RCP-${year}-${rand}`;
  }
});

// Push initial status
paymentReceiptSchema.pre('save', function () {
  if (this.isNew && this.statusHistory.length === 0) {
    this.statusHistory.push({
      status: this.verificationStatus,
      changedBy: 'SYSTEM',
      reason: 'Receipt created',
    });
  }
});

// Indexes
paymentReceiptSchema.index({ receiptId: 1 }, { unique: true });
paymentReceiptSchema.index({ paymentId: 1 });
paymentReceiptSchema.index({ bookingId: 1 });
paymentReceiptSchema.index({ verificationStatus: 1, createdAt: -1 });
paymentReceiptSchema.index({ 'cashDetails.receiptNumber': 1 });

module.exports = mongoose.model('PaymentReceipt', paymentReceiptSchema);
