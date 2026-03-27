'use strict';

/**
 * RoomHold.js — Tracks the ₹15,000 security deposit hold lifecycle.
 *
 * IMPORTANT: This model only applies to NEW onboarding users going forward.
 * Existing users with already-processed payments do not require migration —
 * their ₹15,000 was bundled inside the Phase 1 payment breakdown.
 *
 * Lifecycle:
 *   pending_approval → (admin approves) → active
 *   active → (full payment completed) → converted
 *   active → (user requests refund within 7 days, admin approves) → refunded
 *   active → (21-day window lapses without full payment) → expired
 */

const mongoose = require('mongoose');

const roomHoldSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    roomTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RoomType',
      required: true,
    },

    /**
     * Server-side constant — ₹15,000. NEVER read from request body.
     * Stored here so the audit trail reflects the exact amount paid.
     */
    depositAmount: { type: Number, default: 15000 },

    /** Payment gateway transaction reference for the deposit. */
    depositTransactionId: { type: String, trim: true, default: '' },
    /** Receipt/proof uploaded by the resident. */
    depositReceiptUrl: { type: String, trim: true, default: '' },

    /**
     * Payment mode chosen by the resident at deposit time.
     * Locked here — cannot be changed after deposit submission.
     * full = pay 11 months in one shot (40% discount)
     * half = pay in 2 installments (25% discount)
     */
    paymentMode: {
      type: String,
      enum: ['full', 'half', 'deposit'],
      required: true,
      default: 'full',
    },

    /**
     * For deposit-only mode: ₹1,000 registration fee collected non-refundably.
     * Always 1000 for new deposits. 0 for legacy full/half deposits.
     */
    registrationFeePaid: { type: Number, default: 0 },

    /**
     * Total collected at deposit stage: depositAmount + registrationFeePaid.
     * For deposit-only: 16000 (15000 + 1000).
     * For legacy full/half deposits: 0 (fees were in the main payment).
     */
    totalPaidAtDeposit: { type: Number, default: 0 },

    /**
     * Set when user returns to complete full payment after a 'deposit' mode hold.
     * null until user selects 'full' or 'half' on the return payment page.
     */
    finalPaymentMode: {
      type: String,
      enum: ['full', 'half', null],
      default: null,
    },

    /**
     * Set by admin on deposit approval — this is the clock start for all deadlines.
     * Never set during user-facing initiation.
     */
    depositPaidAt: { type: Date, default: null },

    /** depositPaidAt + 7 days — last moment for a successful refund request. */
    refundDeadline: { type: Date, default: null },

    /** depositPaidAt + 21 days — last moment to complete the full tenure payment. */
    paymentDeadline: { type: Date, default: null },

    status: {
      type: String,
      enum: ['pending_approval', 'active', 'converted', 'refunded', 'expired'],
      default: 'pending_approval',
    },

    /** Set when user calls requestRefund. Admin still needs to approve. */
    refundRequestedAt: { type: Date, default: null },

    /** Set when admin approves the refund record. */
    refundApprovedAt: { type: Date, default: null },
    refundApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    /** Set when full payment is completed and this deposit is credited. */
    convertedAt: { type: Date, default: null },
    /** Payment ObjectId that triggered the conversion. */
    convertedByPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },

    /** Set when the 21-day payment deadline passes without full payment. */
    expiredAt: { type: Date, default: null },

    /** Admin who approved this deposit (set on approveDeposit). */
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'RoomHolds',
  }
);

// Sparse unique index: a user can only have ONE active or pending_approval hold at a time.
// Converted/refunded/expired holds are historical and don't block new bookings.
roomHoldSchema.index(
  { userId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending_approval', 'active'] } },
    name: 'unique_active_hold_per_user',
  }
);

module.exports = mongoose.model('RoomHold', roomHoldSchema);
