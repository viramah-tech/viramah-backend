'use strict';

const mongoose = require('mongoose');
const { planId: newPlanId } = require('../utils/ulid');

/**
 * payment_plans — one document per user, created at track selection.
 * Plan Section 3.2.
 *
 * Notes / decisions:
 *  - bookingId references RoomHold (no `bookings` collection exists).
 *  - components.monthlyRent is GST-inclusive (GST folded in per Phase A decision).
 *  - All amounts are live; the canonical breakdown is always recomputed by
 *    services/adjustmentEngine.js — values stored on phases are snapshots for history.
 */

const componentRateSchema = new mongoose.Schema(
  {
    opted:       { type: Boolean, default: false },
    monthlyRate: { type: Number, default: 0 },
    totalMonths: { type: Number, default: 11 },
    total:       { type: Number, default: 0 },
  },
  { _id: false }
);

const breakdownLineSchema = new mongoose.Schema(
  {
    label:  { type: String, required: true },
    amount: { type: Number, required: true },
    type:   { type: String, enum: ['charge', 'discount', 'credit', 'total'], required: true },
  },
  { _id: false }
);

const phaseSchema = new mongoose.Schema(
  {
    phaseNumber: { type: Number, enum: [1, 2], required: true },
    monthsCovered: { type: Number, required: true },
    componentsDue: {
      type: [String],
      default: [],
    },
    componentsAlreadyCollected: {
      type: [String],
      default: [],
    },
    grossRent:          { type: Number, default: 0 },
    discountRate:       { type: Number, default: 0 },
    discountAmount:     { type: Number, default: 0 },
    netRent:            { type: Number, default: 0 },
    nonRentalTotal:     { type: Number, default: 0 },
    advanceCreditApplied: { type: Number, default: 0 },
    finalAmount:        { type: Number, default: 0 },
    breakdown:          { type: [breakdownLineSchema], default: [] },
    // Partial-payment tracking (running totals over approved payments)
    amountPaid:         { type: Number, default: 0 },
    dueDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ['pending', 'partially_paid', 'paid', 'overdue', 'on_hold', 'locked'],
      default: 'pending',
    },
    paidOn:    { type: Date, default: null },
    // Single paymentId is legacy; paymentIds supports partial payments
    paymentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    paymentIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Payment' }], default: [] },
    lockedReason: { type: String, default: null },
  },
  { _id: false }
);

const paymentPlanSchema = new mongoose.Schema(
  {
    planId: { type: String, unique: true, index: true },
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'RoomHold', default: null },
    roomId:    { type: mongoose.Schema.Types.ObjectId, ref: 'RoomType', default: null },

    trackId:       { type: String, enum: ['full', 'twopart', 'booking'], required: true },
    chosenTrackId: { type: String, enum: ['full', 'twopart', null], default: null },

    components: {
      monthlyRent:        { type: Number, required: true },
      totalMonths:        { type: Number, default: 11 },
      securityDeposit:    { type: Number, default: 0 },
      registrationCharges:{ type: Number, default: 0 },
      lunch:     { type: componentRateSchema, default: () => ({}) },
      transport: { type: componentRateSchema, default: () => ({}) },
    },

    advanceCreditTotal:     { type: Number, default: 0 },
    advanceCreditConsumed:  { type: Number, default: 0 },
    advanceCreditRemaining: { type: Number, default: 0 },

    discountRate:   { type: Number, default: 0 },
    discountSource: { type: String, enum: ['global', 'per_user_override'], default: 'global' },

    phases: { type: [phaseSchema], default: [] },

    status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
    cancelledReason: { type: String, default: null },

    createdBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      role:   { type: String, default: '' },
    },
  },
  { timestamps: true }
);

// Indexes per Section 9
paymentPlanSchema.index({ userId: 1, status: 1 });
paymentPlanSchema.index({ 'phases.phaseNumber': 1, 'phases.status': 1 });
paymentPlanSchema.index({ 'phases.dueDate': 1 });

paymentPlanSchema.pre('save', function () {
  if (!this.planId) this.planId = newPlanId();
});

module.exports = mongoose.model('PaymentPlan', paymentPlanSchema);
