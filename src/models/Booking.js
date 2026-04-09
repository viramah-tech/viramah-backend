'use strict';

/**
 * Booking.js — Anchor collection for the new payment flow (V3).
 *
 * Replaces RoomHold for NEW users. Existing users with active RoomHolds
 * stay on the legacy flow until conversion or expiry.
 *
 * Lifecycle:
 *   DRAFT → PENDING_BOOKING_PAYMENT → UNDER_VERIFICATION
 *     → BOOKING_CONFIRMED (7-day timer starts)
 *     → FINAL_PAYMENT_PENDING → PARTIALLY_PAID → FULLY_PAID → CLOSED
 *
 * Rejected bookings can retry:
 *   UNDER_VERIFICATION → REJECTED → PENDING_BOOKING_PAYMENT (re-submit)
 *
 * Expiry / cancellation:
 *   PENDING_BOOKING_PAYMENT → CANCELLED (price lock or payment window expired)
 *   FINAL_PAYMENT_PENDING  → OVERDUE   (7-day deadline passed)
 *
 * Financial Convention:
 *   ALL monetary fields in `financials` are stored in PAISE (×100 of INR).
 *   Example: ₹15,000 = 1500000 paise.
 */

const mongoose = require('mongoose');
const { prefixed } = require('../utils/ulid');

/* ─── Booking ID Generator ────────────────────────────────────────────────── */

/**
 * Generates a booking ID in the format BK-YYYY-XXXXXX.
 * Uses ULID suffix truncated to 6 chars for collision resistance.
 */
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
    changedBy: { type: String, enum: ['USER', 'ADMIN', 'SYSTEM'], default: 'SYSTEM' },
    reason:    { type: String, default: '' },
    metadata:  { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const installmentSchema = new mongoose.Schema(
  {
    installmentNumber: { type: Number, required: true, enum: [1, 2] },
    period: {
      startMonth: { type: Number, min: 1, max: 11 },
      endMonth:   { type: Number, min: 1, max: 11 },
    },
    totalAmount:     { type: Number, required: true },      // paise
    paidAmount:      { type: Number, default: 0 },          // paise
    remainingAmount: { type: Number, default: 0 },          // paise
    dueDate:         { type: Date, default: null },
    gracePeriodEnd:  { type: Date, default: null },
    status: {
      type: String,
      enum: ['PENDING', 'PARTIALLY_PAID', 'COMPLETED', 'OVERDUE', 'WAIVED'],
      default: 'PENDING',
    },
    payments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }],
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
        selected:  { type: Boolean, default: false },
        type:      { type: String, enum: ['LUNCH', 'DINNER', 'BOTH', null], default: null },
        amount:    { type: Number, default: 0 },    // paise — total for mess tenure
      },
      transport: {
        selected: { type: Boolean, default: false },
        amount:   { type: Number, default: 0 },     // paise — total for transport tenure
      },
    },

    // ── Financial Breakdown (ALL IN PAISE) ───────────────────────────────
    financials: {
      // Booking amount components
      securityDeposit:    { type: Number, default: 1500000 },   // ₹15,000
      registrationFee:    { type: Number, default: 100000 },    // ₹1,000
      registrationGst:    { type: Number, default: 18000 },     // ₹180 (18% of reg fee)
      totalBookingAmount: { type: Number, default: 1618000 },   // ₹16,180

      // Rent calculations (populated after track selection)
      baseRentPerMonth:   { type: Number, default: null },      // e.g. 2453800 = ₹24,538
      baseRentTotal:      { type: Number, default: null },      // baseRentPerMonth × 11

      // Discount info (set when user selects track)
      discountType: {
        type: String,
        enum: ['NONE', 'HALF_YEARLY', 'FULL_TENURE', null],
        default: null,
      },
      discountPercentage: { type: Number, default: null },      // 25 or 40
      discountAmount:     { type: Number, default: null },      // calculated
      discountedRent:     { type: Number, default: null },      // after discount, before tax

      // Tax
      taxRate:    { type: Number, default: 0.12 },               // 12% GST on rent
      taxAmount:  { type: Number, default: null },               // 12% of discountedRent

      // Final rent total
      finalRentTotal: { type: Number, default: null },           // discountedRent + taxAmount

      // Additional services
      messTotal:      { type: Number, default: null },
      transportTotal: { type: Number, default: null },

      // Grand totals
      grandTotal:   { type: Number, default: null },             // everything combined
      totalPaid:    { type: Number, default: 0 },                // sum of approved payments
      totalPending: { type: Number, default: null },             // grandTotal - totalPaid

      // Precision marker
      currency:  { type: String, default: 'INR' },
      precision: { type: String, default: 'paise' },
    },

    // ── Payment Plan (set AFTER booking approval, when user selects track) ──
    paymentPlan: {
      type: {
        type: String,
        enum: ['FULL_TENURE', 'HALF_YEARLY', null],
        default: null,
      },
      selectedAt:   { type: Date, default: null },
      lockedUntil:  { type: Date, default: null },      // 24h change window
      canChangeUntil: { type: Date, default: null },    // after this, locked in
    },

    // ── Installment Tracking (only for HALF_YEARLY) ─────────────────────
    installments: [installmentSchema],

    // ── Status Management ────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        'DRAFT',
        'PENDING_BOOKING_PAYMENT',
        'UNDER_VERIFICATION',
        'BOOKING_CONFIRMED',
        'FINAL_PAYMENT_PENDING',
        'PARTIALLY_PAID',
        'FULLY_PAID',
        'OVERDUE',
        'CANCELLED',
        'REFUND_PROCESSING',
        'CLOSED',
      ],
      default: 'DRAFT',
    },
    statusHistory: [statusHistoryEntrySchema],

    // ── Timer Management ─────────────────────────────────────────────────
    timers: {
      priceLockExpiry:      { type: Date, default: null },   // 15 min from creation
      bookingPaymentExpiry: { type: Date, default: null },   // 30 min for payment submission
      finalPaymentDeadline: { type: Date, default: null },   // 7 days after booking approval
      lastReminderSent:     { type: Date, default: null },
      nextReminderScheduled:{ type: Date, default: null },
    },

    // ── Optimistic Locking ───────────────────────────────────────────────
    version: { type: Number, default: 0 },

    // ── Migration Metadata ───────────────────────────────────────────────
    // Only set for records migrated from RoomHolds
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

// Auto-generate bookingId before saving
bookingSchema.pre('save', function () {
  if (!this.bookingId) {
    this.bookingId = generateBookingId();
  }
});

// Increment version on every save (optimistic locking support)
bookingSchema.pre('save', function () {
  if (!this.isNew) {
    this.version += 1;
  }
});

// Push initial status to statusHistory on creation
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

// Unique booking ID
bookingSchema.index({ bookingId: 1 }, { unique: true });

// Only one active/pending booking per user at a time
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
          'FINAL_PAYMENT_PENDING',
          'PARTIALLY_PAID',
        ],
      },
    },
    name: 'unique_active_booking_per_user',
  }
);

// Timer-based queries
bookingSchema.index({ 'timers.finalPaymentDeadline': 1 }, { sparse: true });
bookingSchema.index({ 'timers.priceLockExpiry': 1 },      { sparse: true });

// Installment due date queries
bookingSchema.index({ 'installments.dueDate': 1 }, { sparse: true });

// Admin listing (status + date sorted)
bookingSchema.index({ status: 1, createdAt: -1 });

/* ─── Statics ─────────────────────────────────────────────────────────────── */

/**
 * Find the active booking for a given user.
 * Returns null if the user has no active booking.
 */
bookingSchema.statics.findActiveForUser = function (userId) {
  return this.findOne({
    userId,
    status: {
      $in: [
        'DRAFT',
        'PENDING_BOOKING_PAYMENT',
        'UNDER_VERIFICATION',
        'BOOKING_CONFIRMED',
        'FINAL_PAYMENT_PENDING',
        'PARTIALLY_PAID',
      ],
    },
  });
};

/* ─── Export ───────────────────────────────────────────────────────────────── */

module.exports = mongoose.model('Booking', bookingSchema);
