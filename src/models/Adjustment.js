'use strict';

const mongoose = require('mongoose');
const { adjustmentId: newAdjustmentId } = require('../utils/ulid');

/**
 * adjustments — every financial modification. Plan Section 3.5.
 * Types: discount_override, discount_global_change, waiver, custom_charge,
 *        penalty, credit, phase_date_change, phase_hold, phase_unlock.
 *
 * `reason` is mandatory — every adjustment must be explainable.
 */

const actorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name:   { type: String, default: '' },
    role:   { type: String, default: '' },
  },
  { _id: false }
);

const adjustmentSchema = new mongoose.Schema(
  {
    adjustmentId: { type: String, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentPlan', default: null },
    phaseNumber: {
      type: mongoose.Schema.Types.Mixed, // 1 | 2 | 'all' | null
      default: null,
    },
    type: {
      type: String,
      enum: [
        'discount_override',
        'discount_global_change',
        'waiver',
        'custom_charge',
        'penalty',
        'credit',
        'phase_date_change',
        'phase_hold',
        'phase_unlock',
      ],
      required: true,
    },
    newDiscountRate: { type: Number, default: null },
    previousRate:    { type: Number, default: null },
    valueType: { type: String, enum: ['flat', 'percentage', null], default: null },
    value:     { type: Number, default: null },
    description: { type: String, default: '' },
    newDueDate:  { type: Date, default: null },
    scope:  { type: String, enum: ['per_user', 'global'], default: 'per_user' },
    reason: { type: String, required: [true, 'Every adjustment requires a reason'] },
    status: {
      type: String,
      enum: ['pending_approval', 'approved', 'rejected', 'applied'],
      default: 'pending_approval',
    },
    appliedBy:  { type: actorSchema, default: () => ({}) },
    approvedBy: { type: actorSchema, default: null },
    appliedAt:  { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

adjustmentSchema.index({ userId: 1, type: 1, status: 1 });
adjustmentSchema.index({ planId: 1, phaseNumber: 1, status: 1 });

adjustmentSchema.pre('save', function () {
  if (!this.adjustmentId) this.adjustmentId = newAdjustmentId();
});

module.exports = mongoose.model('Adjustment', adjustmentSchema);
