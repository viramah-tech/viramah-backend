const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

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
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      // Legacy 'upcoming' retained for pre-rebuild records; new statuses added per plan Section 3.3
      enum: ['pending', 'approved', 'rejected', 'upcoming', 'on_hold', 'disputed'],
      default: 'pending',
    },

    // ── V2 fields (plan Section 3.3) — additive, nullable for legacy records ──
    planId:    { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentPlan', default: null, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'RoomHold', default: null },
    phaseNumber: { type: Number, enum: [1, 2, null], default: null },
    paymentType: {
      type: String,
      enum: [
        'track1_full',
        'track2_phase1',
        'track2_phase2',
        'track3_booking',
        'track3_advance',
        'manual_admin',
        null,
      ],
      default: null,
    },
    // Top-level amount breakdown (snapshot at submission)
    grossRent:            { type: Number, default: null },
    discountAmount:       { type: Number, default: null },
    netRent:              { type: Number, default: null },
    nonRentalTotal:       { type: Number, default: null },
    advanceCreditApplied: { type: Number, default: null },
    // Enum'd paymentMethodV2 — legacy `paymentMethod` (free text) preserved for old records
    paymentMethodV2: {
      type: String,
      enum: ['UPI', 'NEFT', 'RTGS', 'IMPS', 'CASH', 'CHEQUE', 'OTHER', null],
      default: null,
    },
    submittedAt:   { type: Date, default: Date.now },
    reviewedBy:    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      name:   { type: String, default: '' },
      role:   { type: String, default: '' },
    },
    reviewedAt:    { type: Date, default: null },
    reviewRemarks: { type: String, default: null },
    transactionRef:{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

    /** Amount of security deposit already paid that was credited against this payment (0 if no hold). */
    depositCredited: { type: Number, default: 0 },

    /** Which installment this payment represents (1 = first/only, 2 = second half-pay). */
    installmentNumber: { type: Number, enum: [1, 2], default: 1 },

    /** Payment mode chosen by the resident at onboarding time. */
    paymentMode: {
      type: String,
      enum: ['full', 'half', 'deposit'],
      default: null,
    },


    /**
     * Due date for this payment.
     * - Installment 1: onboarding date.
     * - Installment 2 (half-pay): 5 months after installment 1 due date.
     */
    dueDate: { type: Date, default: null },
    paymentMethod: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    remarks: {
      type: String,
      trim: true,
      default: '',
    },
    transactionId: { type: String, trim: true, default: '' },
    receiptUrl: { type: String, trim: true, default: '' },

    /**
     * Immutable price breakdown — set once when the Payment is created.
     * Acts as an audit trail. MUST NOT be modified after initial save.
     * Old Payment documents without breakdown will have null here — handled defensively in service layer.
     */
    breakdown: {
      roomMonthly:          { type: Number, default: null },
      discountedMonthlyBase: { type: Number, default: null }, // post-discount, pre-GST
      monthlyGST:           { type: Number, default: null },
      discountedMonthlyWithGST: { type: Number, default: null },
      roomRentTotal:        { type: Number, default: null }, // for this installment's months
      registrationFee:      { type: Number, default: null },
      securityDeposit:      { type: Number, default: null },
      transportMonthly:     { type: Number, default: null },
      transportTotal:       { type: Number, default: null },
      messMonthly:          { type: Number, default: null },
      messTotal:            { type: Number, default: null },
      messIsLumpSum:        { type: Boolean, default: false },
      discountRate:         { type: Number, default: null },
      gstRate:              { type: Number, default: null },
      tenureMonths:         { type: Number, default: null }, // total tenure months
      installmentMonths:    { type: Number, default: null }, // months covered by THIS installment
      subtotal:             { type: Number, default: null }, // discounted room + addons (no flat fees)
      flatFees:             { type: Number, default: null }, // registrationFee + securityDeposit
      referralDeduction:    { type: Number, default: null },
      finalAmount:          { type: Number, default: null }, // = subtotal + flatFees - referralDeduction - depositCredited
      depositCredited:      { type: Number, default: 0 },   // deposit already paid, credited against this payment
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate paymentId before saving — ULID for new records, legacy uuid fallback.
const { paymentId: newPaymentId } = require('../utils/ulid');
paymentSchema.pre('save', function () {
  if (!this.paymentId) {
    try {
      this.paymentId = newPaymentId();
    } catch (_err) {
      // Fallback in case ulid package not yet installed during migration
      this.paymentId = `PAY-${uuidv4().split('-')[0].toUpperCase()}`;
    }
  }
});

// V2 indexes (plan Section 9)
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ status: 1, submittedAt: -1 });
paymentSchema.index({ planId: 1 });
paymentSchema.index({ transactionId: 1 });

/**
 * Guard: prevent breakdown from being modified once set.
 * The breakdown is an immutable audit trail — once a Payment is created with a
 * breakdown, that breakdown must never change.
 */
paymentSchema.pre('save', function () {
  if (!this.isNew && this.isModified('breakdown')) {
    // If breakdown was already set (not null), block the change
    if (this._doc && this._doc.breakdown && this._doc.breakdown.finalAmount != null) {
      // Restore original breakdown — silently protect immutability
      this.breakdown = this._doc.breakdown;
    }
  }
});

module.exports = mongoose.model('Payment', paymentSchema);
