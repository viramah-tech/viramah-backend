const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Payment.js — V2.0 Enhanced Payment model.
 *
 * ALL monetary values in RUPEES (INR).
 *
 * V2.0 additions:
 *  - installmentContext: partial payment tracking within installments
 *  - amounts: structured amount breakdown (V3)
 *  - method: structured payment method with details
 *  - retryInfo: retry tracking for rejected payments
 *  - Expanded type/category/status enums
 *
 * Legacy V1/V2 fields preserved for backward compat.
 */

const paymentSchema = new mongoose.Schema(
  {
    paymentId: {
      type: String,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },

    // ── Legacy amount (V1 — kept for backward compat) ────────────────────
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },

    // ── Status (expanded for V2.0) ───────────────────────────────────────
    status: {
      type: String,
      enum: [
        // Legacy statuses
        'pending', 'approved', 'rejected', 'upcoming', 'on_hold', 'disputed',
        // V3 statuses
        'INITIATED', 'PENDING_VERIFICATION', 'ON_HOLD', 'APPROVED', 'REJECTED', 'REFUNDED',
      ],
      default: 'pending',
    },

    // ── V2 fields (legacy — preserved) ───────────────────────────────────
    planId:      { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentPlan', default: null, index: true },
    bookingId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    phaseNumber: { type: Number, enum: [1, 2, null], default: null },
    paymentType: {
      type: String,
      enum: [
        'track1_full', 'track2_phase1', 'track2_phase2',
        'track3_booking', 'track3_advance', 'manual_admin',
        'BOOKING',  // V3 alias
        null,
      ],
      default: null,
    },
    grossRent:            { type: Number, default: null },
    discountAmount:       { type: Number, default: null },
    netRent:              { type: Number, default: null },
    nonRentalTotal:       { type: Number, default: null },
    advanceCreditApplied: { type: Number, default: null },
    paymentMethodV2: {
      type: String,
      enum: ['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'OTHER', null],
      default: null,
    },
    submittedAt:    { type: Date, default: Date.now },
    reviewedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      name:   { type: String, default: '' },
      role:   { type: String, default: '' },
    },
    reviewedAt:     { type: Date, default: null },
    reviewRemarks:  { type: String, default: null },
    transactionRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    depositCredited: { type: Number, default: 0 },
    isPartial:       { type: Boolean, default: false },
    installmentNumber: { type: Number, enum: [1, 2], default: 1 },
    paymentMode: {
      type: String,
      enum: ['full', 'half', 'deposit'],
      default: null,
    },

    // ── V2.0: Payment Classification (expanded) ─────────────────────────
    type: {
      type: String,
      enum: [
        'BOOKING', 'RENT', 'INSTALLMENT', 'MESS', 'TRANSPORT',
        'PENALTY', 'REFUND', 'REFERRAL_CREDIT',
      ],
    },
    category: {
      type: String,
      enum: [
        'SECURITY_DEPOSIT', 'REGISTRATION_FEE',
        'ROOM_RENT', 'ROOM_RENT_FULL',
        'ROOM_RENT_INSTALLMENT_1', 'ROOM_RENT_INSTALLMENT_2',
        'INSTALLMENT_1', 'INSTALLMENT_2',    // Legacy aliases
        'MESS_FEE', 'TRANSPORT_FEE',
        'LATE_PENALTY', 'REFERRAL_BONUS',
      ],
    },

    // ── V2.0: Partial Payment Context ────────────────────────────────────
    installmentContext: {
      isPartialPayment:          { type: Boolean, default: false },
      installmentNumber:         { type: Number, default: null },
      installmentPaymentSequence: { type: Number, default: null },  // 1st, 2nd, 3rd partial
      totalInstallmentAmount:    { type: Number, default: null },   // Full installment amount
      thisPaymentAmount:         { type: Number, default: null },   // This partial amount
      remainingAfterThisPayment: { type: Number, default: null },   // What's left after this
    },

    // ── V2.0: Structured Amount Breakdown ────────────────────────────────
    amounts: {
      baseAmount:     { type: Number, default: null },
      discountPercent: { type: Number, default: null },
      discountAmount: { type: Number, default: null },
      taxableAmount:  { type: Number, default: null },
      gstRate:        { type: Number, default: null },
      gstAmount:      { type: Number, default: null },
      totalAmount:    { type: Number, default: null },
      processingFee:  { type: Number, default: 0 },
    },

    // ── V2.0: Structured Payment Method ──────────────────────────────────
    method: {
      type: {
        type: String,
        enum: ['UPI', 'BANK_TRANSFER', 'CASH', null],
        default: null,
      },
      details: {
        upiId:            { type: String, default: null },
        bankAccount:      { type: String, default: null },
        cashReceiptNumber: { type: String, default: null },
      },
    },

    // ── Verification & proof ─────────────────────────────────────────────
    proofDocument: {
      fileUrl:  { type: String, default: null },
      fileKey:  { type: String, default: null },
      fileType: { type: String, default: null },
      fileSize: { type: Number, default: null },
      uploadedAt: { type: Date, default: null },
      ocrData: {
        extractedUtr:    { type: String, default: null },
        extractedAmount: { type: Number, default: null },
        extractedDate:   { type: Date, default: null },
        confidenceScore: { type: Number, default: null },
        processedAt:     { type: Date, default: null },
        rawText:         { type: String, default: null },
      },
      verificationStatus: {
        type: String,
        enum: ['PENDING', 'COMPLETED', 'FAILED'],
        default: 'PENDING',
      },
    },

    // Duplicate prevention
    utrNumber: { type: String, default: null },
    utrHash:   { type: String, default: null },  // SHA256(UTR:Amount:Date)
    duplicateCheck: {
      utrHash:          { type: String, default: null },
      isDuplicate:      { type: Boolean, default: null },
      originalPaymentId: { type: String, default: null },
      checkedAt:        { type: Date, default: null },
    },

    // Admin action log
    adminActions: [{
      action:         { type: String },
      adminId:        { type: String },
      adminName:      { type: String },
      timestamp:      { type: Date },
      reason:         { type: String },
      ipAddress:      { type: String },
      deviceInfo:     { type: String },
      previousStatus: { type: String },
      newStatus:      { type: String },
    }],

    // Reconciliation tracking
    reconciliation: {
      status: {
        type: String,
        enum: ['PENDING', 'MATCHED', 'MISMATCH', 'MANUAL_OVERRIDE'],
        default: 'PENDING',
      },
      bankStatementMatched: { type: Boolean, default: null },
      matchedAt:            { type: Date, default: null },
      bankReference:        { type: String, default: null },
      mismatchReason:       { type: String, default: null },
    },

    // Refund details
    refundDetails: {
      isRefundable:    { type: Boolean, default: null },
      refundAmount:    { type: Number, default: null },
      refundReason:    { type: String, default: null },
      refundStatus: {
        type: String,
        enum: ['NOT_APPLICABLE', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
        default: 'NOT_APPLICABLE',
      },
      refundMethod:    { type: String, default: null },
      refundReference: { type: String, default: null },
      requestedAt:     { type: Date, default: null },
      processedAt:     { type: Date, default: null },
    },

    // ── V2.0: Retry Logic ────────────────────────────────────────────────
    retryInfo: {
      isRetry:          { type: Boolean, default: false },
      originalPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
      retryCount:       { type: Number, default: 0 },
      rejectionReason:  { type: String, default: null },
    },

    // Status history
    statusHistory: [{
      status:    { type: String },
      timestamp: { type: Date, default: Date.now },
      actor: {
        type: { type: String },
        id:   { type: String },
        name: { type: String },
      },
      notes:     { type: String },
      ipAddress: { type: String },
    }],

    // Idempotency
    idempotencyKey: { type: String, sparse: true, unique: true },
    completedAt:    { type: Date, default: null },

    // Legacy fields (preserved)
    dueDate:       { type: Date, default: null },
    paymentMethod: { type: String, trim: true, default: '' },
    description:   { type: String, trim: true, default: '' },
    approvedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    remarks:       { type: String, trim: true, default: '' },
    transactionId: { type: String, trim: true, default: '' },
    receiptUrl:    { type: String, trim: true, default: '' },

    /** Immutable price breakdown — legacy audit trail. MUST NOT be modified after initial save. */
    breakdown: {
      roomMonthly:              { type: Number, default: null },
      discountedMonthlyBase:    { type: Number, default: null },
      monthlyGST:               { type: Number, default: null },
      discountedMonthlyWithGST: { type: Number, default: null },
      roomRentTotal:            { type: Number, default: null },
      registrationFee:          { type: Number, default: null },
      securityDeposit:          { type: Number, default: null },
      transportMonthly:         { type: Number, default: null },
      transportTotal:           { type: Number, default: null },
      messMonthly:              { type: Number, default: null },
      messTotal:                { type: Number, default: null },
      messIsLumpSum:            { type: Boolean, default: false },
      discountRate:             { type: Number, default: null },
      gstRate:                  { type: Number, default: null },
      tenureMonths:             { type: Number, default: null },
      installmentMonths:        { type: Number, default: null },
      subtotal:                 { type: Number, default: null },
      flatFees:                 { type: Number, default: null },
      referralDeduction:        { type: Number, default: null },
      finalAmount:              { type: Number, default: null },
      depositCredited:          { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate paymentId
const { paymentId: newPaymentId } = require('../utils/ulid');
paymentSchema.pre('save', function () {
  if (!this.paymentId) {
    try {
      this.paymentId = newPaymentId();
    } catch (_err) {
      this.paymentId = `PAY-${uuidv4().split('-')[0].toUpperCase()}`;
    }
  }
});

// Indexes
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ status: 1, submittedAt: -1 });
paymentSchema.index({ transactionId: 1 });
paymentSchema.index({ bookingId: 1, type: 1 });
paymentSchema.index({ 'duplicateCheck.utrHash': 1 });
paymentSchema.index({ utrHash: 1 });
paymentSchema.index({ type: 1, status: 1, createdAt: -1 });

// Guard: prevent breakdown from being modified once set
paymentSchema.pre('save', function () {
  if (!this.isNew && this.isModified('breakdown')) {
    if (this._doc && this._doc.breakdown && this._doc.breakdown.finalAmount != null) {
      this.breakdown = this._doc.breakdown;
    }
  }
});

module.exports = mongoose.model('Payment', paymentSchema);
