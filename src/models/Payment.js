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
      enum: ['pending', 'approved', 'rejected', 'upcoming'],
      default: 'pending',
    },

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
     * True when this Payment record represents the ₹16,000 deposit-only transaction
     * (₹15,000 security + ₹1,000 registration fee). False for all normal payments.
     */
    depositOnly: { type: Boolean, default: false },

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
    verificationNotes: { type: String, trim: true, default: '' },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: { type: Date },

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
      depositCredited:      { type: Number, default: 0 },   // deposit already paid, credited here
      // Deposit-only specific fields (populated only when depositOnly: true)
      isDepositOnly:        { type: Boolean, default: false },
      refundableAmount:     { type: Number, default: null }, // 15000 for deposit-only
      nonRefundableAmount:  { type: Number, default: null }, // 1000 for deposit-only
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate paymentId before saving (collision-free)
paymentSchema.pre('save', function () {
  if (!this.paymentId) {
    this.paymentId = `PAY-${uuidv4().split('-')[0].toUpperCase()}`;
  }
});

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
