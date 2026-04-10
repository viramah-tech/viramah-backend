'use strict';

const mongoose = require('mongoose');

/**
 * ReconciliationLog — Standalone collection for bank statement matching.
 *
 * Each record represents a single bank transaction row processed during
 * reconciliation. The system attempts to match it to an existing Payment
 * record, recording the match type, confidence, and any discrepancies.
 *
 * Used by reconciliationService and the admin Reconciliation Dashboard.
 */
const reconciliationLogSchema = new mongoose.Schema(
  {
    // ── Bank Transaction Data ───────────────────────────────────────────────
    bankReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    bankAmount: {
      type: Number,       // paise
      required: true,
    },
    bankDate: {
      type: Date,
      required: true,
    },
    bankNarration: {
      type: String,
      default: '',
      trim: true,
    },
    bankAccountLast4: {
      type: String,
      default: null,
    },

    // ── Match Result ────────────────────────────────────────────────────────
    matchedPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    matchedBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    matchType: {
      type: String,
      enum: [
        'AUTO_EXACT',        // UTR + amount exact match
        'AUTO_PARTIAL',      // UTR match but amount differs
        'MANUAL',            // Admin manually matched
        'UNMATCHED',         // No matching payment found
      ],
      default: 'UNMATCHED',
    },
    confidence: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // ── Discrepancy Tracking ────────────────────────────────────────────────
    discrepancy: {
      hasDiscrepancy: { type: Boolean, default: false },
      type: {
        type: String,
        enum: [
          null,
          'AMOUNT_MISMATCH',
          'DATE_MISMATCH',
          'ORPHAN_BANK_TXN',     // Bank txn with no matching payment
          'ORPHAN_PAYMENT',       // Payment with no matching bank txn
          'DUPLICATE_MATCH',      // Multiple payments match same bank txn
        ],
        default: null,
      },
      expectedAmount: { type: Number, default: null },  // paise
      actualAmount:   { type: Number, default: null },   // paise
      detail:         { type: String, default: '' },
    },

    // ── Resolution ──────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        'PENDING',            // Awaiting processing
        'MATCHED',            // Successfully matched
        'DISCREPANCY',        // Matched but with issues
        'RESOLVED',           // Discrepancy manually resolved
        'IGNORED',            // Admin chose to ignore
      ],
      default: 'PENDING',
    },
    resolvedBy: {
      adminId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      adminName: { type: String, default: null },
      resolution: { type: String, default: null }, // Free-text resolution notes
      resolvedAt: { type: Date, default: null },
    },

    // ── Batch Metadata ──────────────────────────────────────────────────────
    batchId: {
      type: String,
      default: null,
    },
    statementDate: {
      type: Date,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'ReconciliationLogs',
  }
);

// ── Indexes ──────────────────────────────────────────────────────────────────
reconciliationLogSchema.index({ bankReference: 1 }, { unique: true });
reconciliationLogSchema.index({ matchedPaymentId: 1 });
reconciliationLogSchema.index({ matchType: 1, createdAt: -1 });
reconciliationLogSchema.index({ status: 1 });
reconciliationLogSchema.index({ batchId: 1 });
reconciliationLogSchema.index({ 'discrepancy.type': 1, status: 1 });

module.exports = mongoose.model('ReconciliationLog', reconciliationLogSchema);
