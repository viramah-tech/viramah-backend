'use strict';

/**
 * RefundRecord.js — Audit trail for every deposit refund request and its outcome.
 *
 * Created when a resident calls requestRefund.
 * Admin approves or rejects it — the outcome updates both RefundRecord and RoomHold.
 */

const mongoose = require('mongoose');

const refundRecordSchema = new mongoose.Schema(
  {
    roomHoldId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RoomHold',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    /** Amount to be refunded — always ₹15,000 (from RoomHold.depositAmount). */
    amount: { type: Number, required: true },

    /** Free-text reason provided by the resident at refund request time. */
    reason: { type: String, trim: true, default: '' },

    /** When the resident submitted the refund request. */
    requestedAt: { type: Date, required: true },

    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected'],
      default: 'requested',
    },

    /** Set by admin on approval. */
    approvedAt: { type: Date, default: null },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    /** Set by admin on rejection. */
    rejectedAt: { type: Date, default: null },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    rejectionReason: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'RefundRecords',
  }
);

module.exports = mongoose.model('RefundRecord', refundRecordSchema);
