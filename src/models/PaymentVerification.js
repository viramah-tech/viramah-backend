'use strict';

const mongoose = require('mongoose');

/**
 * PaymentVerification — Standalone collection for OCR data, risk scoring,
 * and admin verification workflow.
 *
 * Separates verification concerns from the Payment model to maintain
 * clean domain boundaries and enable independent querying (e.g. admin
 * verification queue sorted by risk score).
 *
 * References:
 *   - Payment via paymentId (1:1 relationship)
 *   - Booking via bookingId (for context)
 *   - User via userId (for risk history)
 */
const paymentVerificationSchema = new mongoose.Schema(
  {
    // ── References ──────────────────────────────────────────────────────────
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      unique: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ── OCR Extracted Data ──────────────────────────────────────────────────
    ocrData: {
      extractedUtr:      { type: String, default: null },
      extractedAmount:   { type: Number, default: null },  // paise
      extractedDate:     { type: Date, default: null },
      confidenceScore:   { type: Number, default: null, min: 0, max: 100 },
      processedAt:       { type: Date, default: null },
      rawText:           { type: String, default: null },
      provider:          { type: String, default: 'TEXTRACT' }, // TEXTRACT, MANUAL
    },

    // ── Risk Assessment ─────────────────────────────────────────────────────
    riskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    riskLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'LOW',
    },
    flags: [
      {
        type: {
          type: String,
          enum: [
            'AMOUNT_MISMATCH',
            'DUPLICATE_UTR',
            'IMAGE_QUALITY_LOW',
            'NEAR_TIMER_EXPIRY',
            'NEW_USER',
            'OCR_FAILURE',
            'MANUAL_REVIEW_REQUIRED',
          ],
        },
        severity: {
          type: String,
          enum: ['INFO', 'WARNING', 'CRITICAL'],
          default: 'INFO',
        },
        detail:    { type: String, default: '' },
        scoreImpact: { type: Number, default: 0 },
        flaggedAt: { type: Date, default: Date.now },
      },
    ],

    // ── Duplicate Check ─────────────────────────────────────────────────────
    duplicateCheck: {
      utrHash:           { type: String, default: null },   // SHA256(UTR:Amount:Date)
      isDuplicate:       { type: Boolean, default: false },
      originalPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
      checkedAt:         { type: Date, default: null },
    },

    // ── Verification Status ─────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        'PENDING',            // Awaiting OCR + risk scoring
        'IN_QUEUE',           // In admin verification queue
        'UNDER_REVIEW',       // Admin is actively reviewing
        'APPROVED',           // Admin approved
        'REJECTED',           // Admin rejected
        'ON_HOLD',            // Admin placed on hold for more info
      ],
      default: 'PENDING',
    },

    // ── Admin Actions ───────────────────────────────────────────────────────
    verifiedBy: {
      adminId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      adminName: { type: String, default: null },
      adminRole: { type: String, default: null },
    },
    verifiedAt: { type: Date, default: null },
    adminNotes: { type: String, default: '' },
    rejectionReason: { type: String, default: null },

    // ── Action History ──────────────────────────────────────────────────────
    actionHistory: [
      {
        action:    { type: String, required: true }, // CREATED, OCR_COMPLETE, SCORED, APPROVED, REJECTED, HELD
        actor: {
          id:   { type: String },
          name: { type: String },
          role: { type: String },
        },
        timestamp: { type: Date, default: Date.now },
        detail:    { type: String, default: '' },
        previousStatus: { type: String, default: null },
        newStatus:      { type: String, default: null },
      },
    ],
  },
  {
    timestamps: true,
    collection: 'PaymentVerifications',
  }
);

// ── Indexes ──────────────────────────────────────────────────────────────────
paymentVerificationSchema.index({ paymentId: 1 }, { unique: true });
paymentVerificationSchema.index({ bookingId: 1 });
paymentVerificationSchema.index({ userId: 1 });
paymentVerificationSchema.index({ status: 1, riskLevel: 1 });
paymentVerificationSchema.index({ 'duplicateCheck.utrHash': 1 });
paymentVerificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PaymentVerification', paymentVerificationSchema);
