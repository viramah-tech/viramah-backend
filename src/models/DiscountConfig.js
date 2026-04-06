'use strict';

const mongoose = require('mongoose');

/**
 * discount_config — one document per track.
 * Plan Section 3.1.
 *
 * Rules:
 *  - `appliesTo` is hardcoded to 'rent_only' — never configurable.
 *  - Every update must append an entry to `history`.
 *  - `isActive: false` means the engine ignores the rate entirely.
 */

const actorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name:   { type: String, trim: true, default: '' },
    role:   { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const historyEntrySchema = new mongoose.Schema(
  {
    previousRate: { type: Number, required: true },
    newRate:      { type: Number, required: true },
    wasActive:    { type: Boolean, required: true },
    nowActive:    { type: Boolean, required: true },
    changedBy:    { type: actorSchema, required: true },
    reason:       { type: String, trim: true, default: '' },
    changedAt:    { type: Date, default: Date.now },
  },
  { _id: false }
);

const discountConfigSchema = new mongoose.Schema(
  {
    trackId: {
      type: String,
      enum: ['full', 'twopart'],
      required: true,
      unique: true, // one doc per track
      index: true,
    },
    defaultDiscountRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    appliesTo: {
      type: String,
      enum: ['rent_only'],
      default: 'rent_only',
      required: true,
    },
    isActive: { type: Boolean, default: true },
    updatedBy: { type: actorSchema, default: () => ({}) },
    history:   { type: [historyEntrySchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: 'updatedAt' } }
);

module.exports = mongoose.model('DiscountConfig', discountConfigSchema);
