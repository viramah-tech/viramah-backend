const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const transactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      unique: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: [true, 'Transaction type is required'],
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: 0,
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['completed', 'pending', 'failed'],
      default: 'completed',
    },


    /** Which installment triggered this transaction (1 or 2). Null for legacy records. */
    installmentNumber: { type: Number, default: null },

    // ── V2 fields (plan Section 3.4) — additive ─────────────────────────────
    planId:    { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentPlan', default: null },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'RoomHold', default: null },
    sourceType: {
      type: String,
      enum: ['payment', 'adjustment', 'refund', 'credit', null],
      default: null,
    },
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    direction: { type: String, enum: ['credit', 'debit', null], default: null },
    typeV2: {
      type: String,
      enum: ['rent', 'security', 'registration', 'lunch', 'transport',
             'advance', 'discount', 'penalty', 'refund', 'adjustment', null],
      default: null,
    },
    balanceBefore: { type: Number, default: null },
    balanceAfter:  { type: Number, default: null },
    postingStatus: {
      type: String,
      enum: ['pending', 'posted', 'failed'],
      default: 'posted', // V2 default — fixes the audit-report sync gap
    },
    postedAt: { type: Date, default: null },
    isCorrectiveEntry:    { type: Boolean, default: false },
    correctsTransactionId:{ type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Auto-generate transactionId before saving — ULID for new records.
const { transactionId: newTxnId } = require('../utils/ulid');
transactionSchema.pre('save', function () {
  if (!this.transactionId) {
    try {
      this.transactionId = newTxnId();
    } catch (_err) {
      this.transactionId = `TXN-${uuidv4().split('-')[0].toUpperCase()}`;
    }
  }
  if (this.postingStatus === 'posted' && !this.postedAt) {
    this.postedAt = new Date();
  }
});

// V2 indexes (plan Section 9)
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ postingStatus: 1, createdAt: -1 });
transactionSchema.index({ sourceType: 1, sourceId: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
