'use strict';

/**
 * Booking.js — V2.0 Anchor collection for the payment flow.
 *
 * Replaces RoomHold for NEW users. Existing users with active RoomHolds
 * stay on the legacy flow until conversion or expiry.
 *
 * Lifecycle (V2.0):
 *   DRAFT → PENDING_BOOKING_PAYMENT → UNDER_VERIFICATION
 *     → BOOKING_CONFIRMED (7-day timer starts)
 *     → TRACK_SELECTED → FINAL_PAYMENT_PENDING
 *     → PARTIALLY_PAID → FULLY_PAID
 *     → SERVICES_PENDING → COMPLETED
 *
 * Rejected bookings can retry:
 *   UNDER_VERIFICATION → REJECTED → PENDING_BOOKING_PAYMENT (re-submit)
 *
 * Expiry / cancellation:
 *   PENDING_BOOKING_PAYMENT → CANCELLED (payment window expired)
 *   FINAL_PAYMENT_PENDING  → OVERDUE   (7-day deadline passed)
 *
 * Financial Convention:
 *   ALL monetary fields are stored in RUPEES (INR).
 *   Example: ₹15,000 = 15000.
 */

const mongoose = require('mongoose');
const { prefixed } = require('../utils/ulid');

/* ─── Booking ID Generator ────────────────────────────────────────────────── */

const generateBookingId = () => {
  const year = new Date().getFullYear();
  const suffix = prefixed('').replace('-', '').slice(0, 6).toUpperCase();
  return `BK-${year}-${suffix}`;
};

/* ─── Sub-schemas ─────────────────────────────────────────────────────────── */

const statusHistoryEntrySchema = new mongoose.Schema(
  {
    status:    { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    changedBy: { type: String, default: 'SYSTEM' },
    reason:    { type: String, default: '' },
    metadata:  { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

/** Tracks a single partial payment contribution to an installment */
const partialPaymentSchema = new mongoose.Schema(
  {
    paymentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    amount:     { type: Number, required: true },  // rupees
    status:     { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    paidAt:     { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
  },
  { _id: false }
);

const installmentSchema = new mongoose.Schema(
  {
    installmentNumber: { type: Number, required: true, enum: [1, 2] },
    type: {
      type: String,
      enum: ['BOOKING', 'INSTALLMENT_1', 'INSTALLMENT_2', 'FULL_PAYMENT'],
      default: 'INSTALLMENT_1',
    },
    period: {
      startMonth: { type: Number, min: 1, max: 11 },
      endMonth:   { type: Number, min: 1, max: 11 },
    },
    totalAmount:     { type: Number, required: true },       // rupees
    amountPaid:      { type: Number, default: 0 },           // rupees — sum of approved partial payments
    amountRemaining: { type: Number, default: 0 },           // rupees — totalAmount - amountPaid
    dueDate:         { type: Date, default: null },
    gracePeriodEnd:  { type: Date, default: null },
    completedAt:     { type: Date, default: null },
    status: {
      type: String,
      enum: ['PENDING', 'PARTIALLY_PAID', 'COMPLETED', 'OVERDUE', 'WAIVED'],
      default: 'PENDING',
    },
    // V2.0: Partial payment tracking — multiple payments per installment
    partialPayments: [partialPaymentSchema],
    // Legacy: direct payment refs (kept for backward compat)
    payments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }],
  },
  { _id: false }
);

/** Admin timer override audit entry */
const timerOverrideSchema = new mongoose.Schema(
  {
    action:        { type: String, enum: ['EXTEND', 'REDUCE', 'PAUSE', 'RESUME', 'RESET'], required: true },
    timerType:     { type: String, required: true },
    previousValue: { type: Date, default: null },
    newValue:      { type: Date, default: null },
    adminId:       { type: String, required: true },
    reason:        { type: String, default: '' },
    timestamp:     { type: Date, default: Date.now },
  },
  { _id: false }
);

/** Service payment item (mess or transport) */
const servicePaymentItemSchema = new mongoose.Schema(
  {
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
    amount:    { type: Number },  // rupees
    status:    { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  },
  { _id: false }
);

/* ─── Bill Display Sub-schemas (for dual bill UI) ─────────────────────────── */

const billBreakdownLineSchema = new mongoose.Schema(
  {
    label:  { type: String, required: true },
    amount: { type: Number, required: true },  // rupees (negative for deductions)
    type:   { type: String, enum: ['SECURITY', 'REGISTRATION_BASE', 'TAX', 'RENT', 'DISCOUNT', 'SERVICE', 'DEDUCTION', 'CREDIT'] },
  },
  { _id: false }
);

const referralCreditSchema = new mongoose.Schema(
  {
    amount:     { type: Number, default: 0 },    // rupees
    referralId: { type: String, default: null },
    label:      { type: String, default: '' },
  },
  { _id: false }
);

/* ─── Main Schema ─────────────────────────────────────────────────────────── */

const bookingSchema = new mongoose.Schema(
  {
    // ── Primary Identification ───────────────────────────────────────────
    bookingId: {
      type: String,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },

    // ── Room & Service Selection ─────────────────────────────────────────
    selections: {
      roomType: {
        type: String,
        enum: ['AXIS_PLUS_STUDIO', 'AXIS_STUDIO', 'COLLECTIVE_1BHK', 'NEXUS_1BHK'],
        required: [true, 'Room type is required'],
      },
      roomTypeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RoomType',
        required: [true, 'Room type reference is required'],
      },
      tenure: { type: Number, default: 11, min: 11, max: 11 },
      mess: {
        selected: { type: Boolean, default: false },
        type:     { type: String, enum: ['LUNCH', 'DINNER', 'BOTH', null], default: null },
      },
      transport: {
        selected: { type: Boolean, default: false },
        routes:   [String],
      },
    },

    // ── V2.0 DUAL BILL DISPLAY DATA ─────────────────────────────────────
    // For UI rendering only. Calculated at booking creation, updated on track selection.
    displayBills: {
      // Booking amount breakdown (fixed ₹16,180)
      bookingBill: {
        securityDeposit: {
          amount:    { type: Number, default: 15000 },
          gstRate:   { type: Number, default: 0 },
          gstAmount: { type: Number, default: 0 },
          total:     { type: Number, default: 15000 },
        },
        registrationFee: {
          baseAmount: { type: Number, default: 1000 },
          gstRate:    { type: Number, default: 0.18 },
          gstAmount:  { type: Number, default: 180 },
          total:      { type: Number, default: 1180 },
        },
        totalPayable: { type: Number, default: 16180 },
        breakdown: [billBreakdownLineSchema],
      },
      // Projected final bill — computed for BOTH track options
      projectedFinalBill: {
        // Full Tenure option
        fullTenure: {
          track:           { type: String, default: 'FULL_TENURE' },
          discountPercent: { type: Number, default: 40 },
          roomRent: {
            baseMonthly:        { type: Number, default: null },
            tenure:             { type: Number, default: 11 },
            subtotal:           { type: Number, default: null },
            discountPercent:    { type: Number, default: 40 },
            discountAmount:     { type: Number, default: null },
            discountedSubtotal: { type: Number, default: null },
            gstRate:            { type: Number, default: 0.18 },
            gstAmount:          { type: Number, default: null },
            total:              { type: Number, default: null },
          },
          mess:      { type: mongoose.Schema.Types.Mixed, default: null },
          transport: { type: mongoose.Schema.Types.Mixed, default: null },
          deductions: {
            securityDeposit: {
              amount: { type: Number, default: 15000 },
              label:  { type: String, default: 'Security Deposit Credit' },
            },
            referralCredits: [referralCreditSchema],
            otherCredits:    [{ amount: Number, reason: String }],
          },
          grandTotal:          { type: Number, default: null },
          totalAfterDeductions: { type: Number, default: null },
        },
        // Half Yearly option
        halfYearly: {
          track:           { type: String, default: 'HALF_YEARLY' },
          discountPercent: { type: Number, default: 25 },
          firstInstallment: {
            months:     { type: Number, default: 6 },
            totalAmount: { type: Number, default: null },
            breakdown:   { type: mongoose.Schema.Types.Mixed, default: null },
          },
          secondInstallment: {
            months:     { type: Number, default: 5 },
            dueDate:    { type: Date, default: null },
            totalAmount: { type: Number, default: null },
            breakdown:   { type: mongoose.Schema.Types.Mixed, default: null },
          },
          mess:      { type: mongoose.Schema.Types.Mixed, default: null },
          transport: { type: mongoose.Schema.Types.Mixed, default: null },
          deductions: {
            securityDeposit: {
              amount: { type: Number, default: 15000 },
              label:  { type: String, default: 'Security Deposit Credit' },
            },
            referralCredits: [referralCreditSchema],
            otherCredits:    [{ amount: Number, reason: String }],
          },
          grandTotal:          { type: Number, default: null },
          totalAfterDeductions: { type: Number, default: null },
        },
        effectiveDate: { type: Date, default: null },
      },
    },

    // ── Financial Breakdown (ALL IN RUPEES) ──────────────────────────────
    financials: {
      // Booking amount components
      securityDeposit:    { type: Number, default: 15000 },    // ₹15,000
      registrationFee:    { type: Number, default: 1000 },     // ₹1,000
      registrationGst:    { type: Number, default: 180 },      // ₹180 (18% of reg fee)
      totalBookingAmount: { type: Number, default: 16180 },    // ₹16,180

      // Rent calculations (populated after track selection)
      baseRentPerMonth:   { type: Number, default: null },
      baseRentTotal:      { type: Number, default: null },     // baseRentPerMonth × 11

      // Discount info (set when user selects track)
      discountType: {
        type: String,
        enum: ['NONE', 'HALF_YEARLY', 'FULL_TENURE', null],
        default: null,
      },
      discountPercentage: { type: Number, default: null },     // 25 or 40
      discountAmount:     { type: Number, default: null },
      discountedRent:     { type: Number, default: null },

      // Tax
      taxRate:    { type: Number, default: 0.18 },              // 18% GST
      taxAmount:  { type: Number, default: null },

      // Final rent total
      finalRentTotal: { type: Number, default: null },

      // Additional services
      messTotal:      { type: Number, default: null },
      transportTotal: { type: Number, default: null },

      // Grand totals
      grandTotal:   { type: Number, default: null },
      totalPaid:    { type: Number, default: 0 },
      totalPending: { type: Number, default: null },

      currency: { type: String, default: 'INR' },
    },

    // ── Payment Plan (V2.0 — enhanced) ──────────────────────────────────
    paymentPlan: {
      selectedTrack: {
        type: String,
        enum: ['FULL_TENURE', 'HALF_YEARLY', null],
        default: null,
      },
      selectedAt:    { type: Date, default: null },
      lockedUntil:   { type: Date, default: null },
      canChangeUntil: { type: Date, default: null },
      baseAmounts: {
        roomRentTotal:  { type: Number, default: null },
        messTotal:      { type: Number, default: null },
        transportTotal: { type: Number, default: null },
      },
    },

    // ── Installment Tracking ────────────────────────────────────────────
    installments: [installmentSchema],

    // ── V2.0: Service Payments (Mess/Transport — independent from rent) ──
    servicePayments: {
      mess: {
        totalAmount: { type: Number, default: null },
        amountPaid:  { type: Number, default: 0 },
        payments:    [servicePaymentItemSchema],
        status: {
          type: String,
          enum: ['NOT_APPLICABLE', 'PENDING', 'PARTIALLY_PAID', 'COMPLETED'],
          default: 'NOT_APPLICABLE',
        },
      },
      transport: {
        totalAmount: { type: Number, default: null },
        amountPaid:  { type: Number, default: 0 },
        payments:    [servicePaymentItemSchema],
        status: {
          type: String,
          enum: ['NOT_APPLICABLE', 'PENDING', 'PARTIALLY_PAID', 'COMPLETED'],
          default: 'NOT_APPLICABLE',
        },
      },
    },

    // ── Status Management ────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        'DRAFT',
        'PENDING_BOOKING_PAYMENT',
        'UNDER_VERIFICATION',
        'BOOKING_CONFIRMED',
        'TRACK_SELECTED',            // V2.0: After user selects full/half
        'FINAL_PAYMENT_PENDING',
        'PARTIALLY_PAID',
        'FULLY_PAID',
        'SERVICES_PENDING',          // V2.0: Room paid, mess/transport pending
        'COMPLETED',                 // V2.0: Everything paid
        'OVERDUE',
        'CANCELLED',
        'REFUND_PROCESSING',
        'CLOSED',
      ],
      default: 'DRAFT',
    },
    statusHistory: [statusHistoryEntrySchema],

    // ── Timer Management (V2.0 — enhanced with admin overrides) ─────────
    timers: {
      priceLockExpiry:       { type: Date, default: null },
      bookingPaymentExpiry:  { type: Date, default: null },   // 30 min for payment
      finalPaymentDeadline:  { type: Date, default: null },   // 7 days after approval
      lastReminderSent:      { type: Date, default: null },
      nextReminderScheduled: { type: Date, default: null },
      installmentDeadlines: [{
        installmentNumber: Number,
        deadline:          Date,
      }],
      // V2.0: Pause state
      finalPaymentDeadlinePaused: {
        pausedAt:    { type: Date, default: null },
        remainingMs: { type: Number, default: null },
      },
      // V2.0: Full audit trail for all timer changes
      adminOverrides: [timerOverrideSchema],
    },

    // ── V2.0: Discount Overrides (Per-user, per-booking) ────────────────
    discountOverrides: {
      fullTenurePercent:      { type: Number, default: null },
      halfYearlyPercent:      { type: Number, default: null },
      messDiscountPercent:    { type: Number, default: null },
      transportDiscountPercent: { type: Number, default: null },
      validUntil:  { type: Date, default: null },
      setBy:       { type: String, default: null },
      setAt:       { type: Date, default: null },
    },

    // ── V2.0: Referral ──────────────────────────────────────────────────
    referral: {
      referrerCode:       { type: String, default: null },
      referrerUserId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      creditApplied:      { type: Number, default: 0 },       // ₹1000 max
      friendCreditApplied: { type: Boolean, default: false },
    },

    // ── Optimistic Locking ───────────────────────────────────────────────
    version: { type: Number, default: 0 },

    // ── Migration Metadata ───────────────────────────────────────────────
    _migratedFrom: {
      collection: { type: String, default: null },
      originalId: { type: mongoose.Schema.Types.ObjectId, default: null },
      migratedAt: { type: Date, default: null },
    },

    // ── Audit ────────────────────────────────────────────────────────────
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    collection: 'Bookings',
  }
);

/* ─── Hooks ───────────────────────────────────────────────────────────────── */

bookingSchema.pre('save', function () {
  if (!this.bookingId) {
    this.bookingId = generateBookingId();
  }
});

bookingSchema.pre('save', function () {
  if (!this.isNew) {
    this.version += 1;
  }
});

bookingSchema.pre('save', function () {
  if (this.isNew && this.statusHistory.length === 0) {
    this.statusHistory.push({
      status: this.status,
      changedBy: 'SYSTEM',
      reason: 'Booking created',
    });
  }
});

/* ─── Indexes ─────────────────────────────────────────────────────────────── */

bookingSchema.index({ bookingId: 1 }, { unique: true });

bookingSchema.index(
  { userId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          'DRAFT',
          'PENDING_BOOKING_PAYMENT',
          'UNDER_VERIFICATION',
          'BOOKING_CONFIRMED',
          'TRACK_SELECTED',
          'FINAL_PAYMENT_PENDING',
          'PARTIALLY_PAID',
          'SERVICES_PENDING',
        ],
      },
    },
    name: 'unique_active_booking_per_user',
  }
);

bookingSchema.index({ 'timers.finalPaymentDeadline': 1 }, { sparse: true });
bookingSchema.index({ 'timers.priceLockExpiry': 1 },      { sparse: true });
bookingSchema.index({ 'timers.bookingPaymentExpiry': 1 },  { sparse: true });
bookingSchema.index({ 'installments.dueDate': 1 },         { sparse: true });
bookingSchema.index({ status: 1, createdAt: -1 });

/* ─── Statics ─────────────────────────────────────────────────────────────── */

bookingSchema.statics.findActiveForUser = function (userId) {
  return this.findOne({
    userId,
    status: {
      $in: [
        'DRAFT',
        'PENDING_BOOKING_PAYMENT',
        'UNDER_VERIFICATION',
        'BOOKING_CONFIRMED',
        'TRACK_SELECTED',
        'FINAL_PAYMENT_PENDING',
        'PARTIALLY_PAID',
        'SERVICES_PENDING',
      ],
    },
  });
};

/* ─── Export ───────────────────────────────────────────────────────────────── */

module.exports = mongoose.model('Booking', bookingSchema);
