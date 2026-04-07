'use strict';

/**
 * accountantService — financial dashboard. Plan Section 4.6.
 */

const Payment        = require('../models/Payment');
const Transaction    = require('../models/Transaction');
const PaymentPlan    = require('../models/PaymentPlan');
const Adjustment     = require('../models/Adjustment');
const DiscountConfig = require('../models/DiscountConfig');

function startOfMonth(d = new Date()) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }

async function getSummary() {
  const monthStart = startOfMonth();
  const [collectedAgg, expectedAgg, activeDiscounts] = await Promise.all([
    Payment.aggregate([
      { $match: { status: 'approved', reviewedAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    PaymentPlan.aggregate([
      { $match: { status: 'active' } },
      { $unwind: '$phases' },
      { $match: { 'phases.dueDate': { $gte: monthStart, $lte: new Date(new Date().setMonth(new Date().getMonth() + 1)) } } },
      { $group: { _id: null, total: { $sum: '$phases.finalAmount' }, count: { $sum: 1 } } },
    ]),
    DiscountConfig.find({ isActive: true }),
  ]);
  return {
    monthStart,
    collectedThisMonth: { total: collectedAgg[0]?.total || 0, count: collectedAgg[0]?.count || 0 },
    expectedThisMonth:  { total: expectedAgg[0]?.total  || 0, count: expectedAgg[0]?.count  || 0 },
    activeDiscounts: activeDiscounts.map((d) => ({ trackId: d.trackId, rate: d.defaultDiscountRate })),
  };
}

async function getOverdue() {
  const today = new Date();
  const plans = await PaymentPlan.find({
    status: 'active',
    'phases.status': { $in: ['pending', 'overdue'] },
    'phases.dueDate': { $lt: today },
  }).populate('userId', 'userId name email phone roomNumber');

  const overdue = [];
  for (const plan of plans) {
    for (const phase of plan.phases) {
      if (['pending', 'overdue'].includes(phase.status) && phase.dueDate && phase.dueDate < today) {
        overdue.push({
          planId: plan._id,
          user: plan.userId,
          phaseNumber: phase.phaseNumber,
          dueDate: phase.dueDate,
          amount: phase.finalAmount,
          daysOverdue: Math.floor((today - phase.dueDate) / (1000 * 60 * 60 * 24)),
        });
      }
    }
  }
  return { count: overdue.length, items: overdue };
}

async function getLedger({ userId, sourceType, page = 1, limit = 50 } = {}) {
  const q = { postingStatus: 'posted' };
  if (userId)     q.userId = userId;
  if (sourceType) q.sourceType = sourceType;
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Transaction.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('userId', 'userId name'),
    Transaction.countDocuments(q),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function getDiscountImpact() {
  // Sum of all discountAmount from approved payments this month
  const monthStart = startOfMonth();
  const agg = await Payment.aggregate([
    { $match: { status: 'approved', reviewedAt: { $gte: monthStart } } },
    { $group: {
        _id: '$paymentType',
        totalDiscount: { $sum: '$discountAmount' },
        totalApproved: { $sum: '$amount' },
        count: { $sum: 1 },
    } },
  ]);
  const total = agg.reduce((s, r) => s + (r.totalDiscount || 0), 0);
  return { monthStart, totalDiscount: total, byPaymentType: agg };
}

async function getAdjustmentsList({ type, userId, page = 1, limit = 50 } = {}) {
  const q = {};
  if (type)   q.type = type;
  if (userId) q.userId = userId;
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    Adjustment.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('userId', 'userId name'),
    Adjustment.countDocuments(q),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function getUserLedger(userId) {
  if (!userId) { const e = new Error('userId is required'); e.statusCode = 400; throw e; }
  const txns = await Transaction.find({ userId, postingStatus: 'posted' })
    .sort({ createdAt: 1 })
    .populate('userId', 'userId name email phone');
  let running = 0;
  const items = txns.map((t) => {
    const dir = t.direction || t.type;
    const signed = dir === 'credit' ? t.amount : -t.amount;
    running += signed;
    return { ...t.toObject(), signedAmount: signed, runningBalance: running };
  });
  return { userId, balance: running, items };
}

async function getAgingReport() {
  const today = new Date();
  const plans = await PaymentPlan.find({ status: 'active' })
    .populate('userId', 'userId name email phone roomNumber');
  const buckets = { '0-30': [], '30-60': [], '60-90': [], '90+': [] };
  for (const plan of plans) {
    for (const phase of plan.phases) {
      if (!['pending', 'overdue'].includes(phase.status)) continue;
      if (!phase.dueDate || phase.dueDate >= today) continue;
      const days = Math.floor((today - phase.dueDate) / 86400000);
      const item = {
        planId: plan._id, user: plan.userId, phaseNumber: phase.phaseNumber,
        dueDate: phase.dueDate, amount: phase.finalAmount, daysOverdue: days,
      };
      if (days <= 30)      buckets['0-30'].push(item);
      else if (days <= 60) buckets['30-60'].push(item);
      else if (days <= 90) buckets['60-90'].push(item);
      else                 buckets['90+'].push(item);
    }
  }
  const totals = Object.fromEntries(
    Object.entries(buckets).map(([k, arr]) => [k, { count: arr.length, total: arr.reduce((s, x) => s + (x.amount || 0), 0) }])
  );
  return { buckets, totals };
}

async function getCashFlowTrend(months = 6) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const collected = await Payment.aggregate([
    { $match: { status: 'approved', reviewedAt: { $gte: start } } },
    { $group: {
        _id: { y: { $year: '$reviewedAt' }, m: { $month: '$reviewedAt' } },
        total: { $sum: '$amount' }, count: { $sum: 1 },
    } },
    { $sort: { '_id.y': 1, '_id.m': 1 } },
  ]);
  const series = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const row = collected.find((c) => c._id.y === d.getFullYear() && c._id.m === d.getMonth() + 1);
    series.push({
      label: d.toLocaleString('en-US', { month: 'short', year: '2-digit' }),
      total: row?.total || 0,
      count: row?.count || 0,
    });
  }
  return { series };
}

async function getDepositPipeline() {
  const RoomHold = require('../models/RoomHold');
  const agg = await RoomHold.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } },
  ]);
  return { byStatus: agg };
}

async function getRevenueBreakdown() {
  const monthStart = startOfMonth();
  const txns = await Transaction.find({
    postingStatus: 'posted',
    direction: 'credit',
    createdAt: { $gte: monthStart },
  });
  const map = {};
  for (const t of txns) {
    const key = t.category || t.typeV2 || 'other';
    map[key] = (map[key] || 0) + t.amount;
  }
  return { monthStart, breakdown: Object.entries(map).map(([category, total]) => ({ category, total })) };
}

module.exports = {
  getSummary,
  getOverdue,
  getLedger,
  getDiscountImpact,
  getAdjustmentsList,
  getUserLedger,
  getAgingReport,
  getCashFlowTrend,
  getDepositPipeline,
  getRevenueBreakdown,
};
