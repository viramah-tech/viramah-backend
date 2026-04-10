'use strict';

/**
 * discountService — admin/accountant management of discount_config + per-user overrides.
 * Plan Section 4.3.
 *
 * - Global rate changes append a history entry on every save.
 * - Per-user overrides are stored as Adjustment(type='discount_override', status='approved').
 * - Setting an override removes any prior pending/approved override for the same user.
 */

const DiscountConfig = require('../models/DiscountConfig');
const Adjustment     = require('../models/Adjustment');
const { emitToAdmins, emitToUser } = require('./socket-service');

const err = (m, s = 400) => Object.assign(new Error(m), { statusCode: s });

async function getAllConfigs() {
  return DiscountConfig.find({}).sort({ trackId: 1 });
}

async function updateGlobalDiscount(trackId, { newRate, isActive, reason, actor }) {
  if (!['full', 'twopart'].includes(trackId)) throw err('Invalid trackId', 400);
  if (newRate != null && (newRate < 0 || newRate > 1)) throw err('newRate must be between 0 and 1', 400);
  if (!reason || !String(reason).trim()) throw err('reason is required for any discount change', 400);

  const cfg = await DiscountConfig.findOne({ trackId });
  if (!cfg) throw err(`discount_config for '${trackId}' not found — run seed first`, 404);

  const previousRate = cfg.defaultDiscountRate;
  const wasActive    = cfg.isActive;
  const nextRate     = newRate != null ? Number(newRate) : previousRate;
  const nextActive   = isActive != null ? !!isActive : wasActive;

  cfg.defaultDiscountRate = nextRate;
  cfg.isActive            = nextActive;
  cfg.updatedBy           = actor || cfg.updatedBy;
  cfg.history.push({
    previousRate,
    newRate:   nextRate,
    wasActive,
    nowActive: nextActive,
    changedBy: actor || {},
    reason:    String(reason).trim(),
    changedAt: new Date(),
  });
  await cfg.save();

  emitToAdmins('discount:updated', {
    trackId,
    newRate:  nextRate,
    isActive: nextActive,
    changedBy: actor || null,
  });

  return cfg;
}

async function getDiscountHistory(trackId) {
  if (!['full', 'twopart'].includes(trackId)) throw err('Invalid trackId', 400);
  const cfg = await DiscountConfig.findOne({ trackId });
  if (!cfg) throw err('Not found', 404);
  return cfg.history.slice().sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
}

/**
 * POST /api/admin/adjustments/discount-override
 * Sets a per-user override. Marks any prior override for the same user as 'rejected'.
 */
async function setOverride({ userId, newDiscountRate, reason, actor }) {
  if (!userId) throw err('userId is required', 400);
  if (newDiscountRate == null || newDiscountRate < 0 || newDiscountRate > 1) {
    throw err('newDiscountRate must be between 0 and 1', 400);
  }
  if (!reason || !String(reason).trim()) throw err('reason is required', 400);

  // Cancel previous overrides
  await Adjustment.updateMany(
    { userId, type: 'discount_override', status: { $in: ['pending_approval', 'approved'] } },
    { $set: { status: 'rejected' } }
  );

  const adj = await Adjustment.create({
    userId,
    type:            'discount_override',
    newDiscountRate: Number(newDiscountRate),
    scope:           'per_user',
    reason:          String(reason).trim(),
    status:          'approved', // admin action — auto-approved
    appliedBy:       actor || {},
    approvedBy:      actor || {},
    appliedAt:       new Date(),
  });

  const payload = { userId, newRate: adj.newDiscountRate, adjustmentId: adj._id };
  emitToAdmins('discount:override_set', payload);
  emitToUser(String(userId), 'discount:override_set', payload);

  return adj;
}

async function removeOverride(userId) {
  if (!userId) throw err('userId is required', 400);
  const result = await Adjustment.updateMany(
    { userId, type: 'discount_override', status: 'approved' },
    { $set: { status: 'rejected' } }
  );
  emitToAdmins('discount:override_set', { userId, newRate: null, adjustmentId: null });
  emitToUser(String(userId), 'discount:override_set', { userId, newRate: null, adjustmentId: null });
  return { removed: result.modifiedCount || 0 };
}

module.exports = {
  getAllConfigs,
  updateGlobalDiscount,
  getDiscountHistory,
  setOverride,
  removeOverride,
};
