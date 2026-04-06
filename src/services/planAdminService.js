'use strict';

/**
 * planAdminService — admin operations on payment_plans + adjustments.
 * Plan Section 4.5.
 */

const PaymentPlan = require('../models/PaymentPlan');
const Adjustment  = require('../models/Adjustment');
const AuditLog    = require('../models/AuditLog');
const { emitToAdmins, emitToUser } = require('./socketService');

const err = (m, s = 400) => Object.assign(new Error(m), { statusCode: s });

// ── Listing / detail ─────────────────────────────────────────────────────────

async function listPlans({ status, trackId, userId, page = 1, limit = 20 } = {}) {
  const q = {};
  if (status)  q.status = status;
  if (trackId) q.trackId = trackId;
  if (userId)  q.userId = userId;
  const skip = (page - 1) * limit;
  const [plans, total] = await Promise.all([
    PaymentPlan.find(q)
      .populate('userId', 'userId name email phone roomNumber')
      .sort({ createdAt: -1 })
      .skip(skip).limit(limit),
    PaymentPlan.countDocuments(q),
  ]);
  return { plans, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function getPlanDetail(planId) {
  const plan = await PaymentPlan.findById(planId)
    .populate('userId', 'userId name email phone roomNumber');
  if (!plan) throw err('Plan not found', 404);
  const adjustments = await Adjustment.find({ planId }).sort({ createdAt: -1 });
  return { plan, adjustments };
}

// ── Phase 2 date management ──────────────────────────────────────────────────

async function setPhase2Date(planId, { dueDate, actor }) {
  const plan = await PaymentPlan.findById(planId);
  if (!plan) throw err('Plan not found', 404);
  const phase2 = plan.phases.find((p) => p.phaseNumber === 2);
  if (!phase2) throw err('This plan has no Phase 2', 400);

  const previous = phase2.dueDate;
  phase2.dueDate = dueDate ? new Date(dueDate) : null;

  // If still locked but date is set and in the past/today, unlock immediately
  if (phase2.status === 'locked' && phase2.dueDate && phase2.dueDate <= new Date()) {
    phase2.status = 'pending';
    phase2.lockedReason = null;
  } else if (phase2.status === 'locked' && phase2.dueDate) {
    phase2.lockedReason = `Locked until ${phase2.dueDate.toISOString().slice(0, 10)}`;
  }
  await plan.save();

  // Record as adjustment
  await Adjustment.create({
    userId: plan.userId,
    planId: plan._id,
    phaseNumber: 2,
    type: 'phase_date_change',
    newDueDate: phase2.dueDate,
    reason: `Phase 2 due date changed from ${previous || 'null'} to ${phase2.dueDate || 'null'}`,
    status: 'applied',
    appliedBy: actor || {},
    approvedBy: actor || {},
    appliedAt: new Date(),
  });

  // Emit phase2_unlocked if it transitioned to pending
  if (phase2.status === 'pending') {
    emitToUser(String(plan.userId), 'payment:phase2_unlocked', {
      planId: plan._id,
      userId: plan.userId,
      phaseNumber: 2,
      dueDate: phase2.dueDate,
      finalAmount: phase2.finalAmount || null,
    });
  }

  return plan;
}

async function holdPhase(planId, { phaseNumber, reason, actor }) {
  if (!reason) throw err('reason is required', 400);
  const plan = await PaymentPlan.findById(planId);
  if (!plan) throw err('Plan not found', 404);
  const phase = plan.phases.find((p) => p.phaseNumber === Number(phaseNumber));
  if (!phase) throw err(`Phase ${phaseNumber} not found`, 404);

  phase.status = 'on_hold';
  phase.lockedReason = String(reason).trim();
  await plan.save();

  await Adjustment.create({
    userId: plan.userId, planId: plan._id, phaseNumber: Number(phaseNumber),
    type: 'phase_hold', reason: String(reason).trim(),
    status: 'applied', appliedBy: actor || {}, appliedAt: new Date(),
  });

  return plan;
}

async function unlockPhase(planId, { phaseNumber, actor }) {
  const plan = await PaymentPlan.findById(planId);
  if (!plan) throw err('Plan not found', 404);
  const phase = plan.phases.find((p) => p.phaseNumber === Number(phaseNumber));
  if (!phase) throw err(`Phase ${phaseNumber} not found`, 404);
  if (!['locked', 'on_hold'].includes(phase.status)) {
    throw err(`Phase is already ${phase.status}`, 400);
  }

  phase.status       = 'pending';
  phase.lockedReason = null;
  if (!phase.dueDate) phase.dueDate = new Date();
  await plan.save();

  await Adjustment.create({
    userId: plan.userId, planId: plan._id, phaseNumber: Number(phaseNumber),
    type: 'phase_unlock', reason: 'Manual unlock by admin',
    status: 'applied', appliedBy: actor || {}, appliedAt: new Date(),
  });

  if (Number(phaseNumber) === 2) {
    emitToUser(String(plan.userId), 'payment:phase2_unlocked', {
      planId: plan._id, userId: plan.userId,
      phaseNumber: 2, dueDate: phase.dueDate, finalAmount: phase.finalAmount || null,
    });
  }
  return plan;
}

// ── Monetary adjustments ─────────────────────────────────────────────────────

async function addCustomCharge({ userId, planId, phaseNumber, valueType, value, description, reason, actor }) {
  if (!userId || !planId || !value || !description || !reason) {
    throw err('userId, planId, value, description, and reason are required', 400);
  }
  if (!['flat', 'percentage'].includes(valueType)) throw err('valueType must be flat or percentage', 400);

  const adj = await Adjustment.create({
    userId, planId,
    phaseNumber: phaseNumber || 'all',
    type: 'custom_charge',
    valueType, value: Number(value),
    description: String(description).trim(),
    reason:      String(reason).trim(),
    status: 'approved',
    appliedBy:  actor || {},
    approvedBy: actor || {},
    appliedAt:  new Date(),
  });
  return adj;
}

async function addWaiver({ userId, planId, phaseNumber, valueType, value, description, reason, actor }) {
  if (!userId || !planId || !value || !reason) {
    throw err('userId, planId, value, and reason are required', 400);
  }
  if (!['flat', 'percentage'].includes(valueType || 'flat')) {
    throw err('valueType must be flat or percentage', 400);
  }
  const adj = await Adjustment.create({
    userId, planId,
    phaseNumber: phaseNumber || 'all',
    type: 'waiver',
    valueType: valueType || 'flat',
    value: Number(value),
    description: description || 'Waiver',
    reason: String(reason).trim(),
    status: 'approved',
    appliedBy:  actor || {},
    approvedBy: actor || {},
    appliedAt:  new Date(),
  });
  return adj;
}

module.exports = {
  listPlans,
  getPlanDetail,
  setPhase2Date,
  holdPhase,
  unlockPhase,
  addCustomCharge,
  addWaiver,
};
