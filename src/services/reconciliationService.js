'use strict';

/**
 * reconciliationService.js — Automated bank matching and reconciliation.
 *
 * REFACTORED: Now writes reconciliation data to the dedicated ReconciliationLog
 * collection instead of directly onto Payment documents. Payment.reconciliation
 * subdocument is kept updated as a denormalized status for backward compat.
 */

const { v4: uuidv4 } = require('uuid');
const Payment = require('../models/Payment');
const ReconciliationLog = require('../models/ReconciliationLog');

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * Handles daily bank statement matching.
 * Creates ReconciliationLog entries for each bank transaction row,
 * and updates Payment.reconciliation as a denormalized status.
 */
async function processBankStatement(transactionsData) {
  const batchId = `BATCH-${Date.now()}-${uuidv4().slice(0, 8)}`;
  const results = { matched: 0, mismatched: 0, notFound: 0, batchId };

  for (const record of transactionsData) {
    const bankRef = String(record.bankRef || record.utr || '').trim();
    if (!bankRef) {
      results.notFound++;
      continue;
    }

    // Skip if this bank reference was already processed (idempotent)
    const existingLog = await ReconciliationLog.findOne({ bankReference: bankRef });
    if (existingLog) {
      // Already processed — count it in the right bucket
      if (existingLog.matchType === 'AUTO_EXACT') results.matched++;
      else if (existingLog.matchType === 'AUTO_PARTIAL') results.mismatched++;
      else results.notFound++;
      continue;
    }

    const bankAmount = Number(record.amount);
    const bankDate = record.date ? new Date(record.date) : new Date();

    // Exact match: UTR + Amount
    const payment = await Payment.findOne({
      transactionId: String(record.utr).trim(),
      amount: bankAmount,
      status: { $in: ['pending', 'approved'] },
    });

    if (payment) {
      // Create ReconciliationLog entry (source of truth)
      await ReconciliationLog.create({
        bankReference: bankRef,
        bankAmount,
        bankDate,
        bankNarration: record.narration || '',
        matchedPaymentId: payment._id,
        matchedBookingId: payment.bookingId || null,
        matchType: 'AUTO_EXACT',
        confidence: 100,
        status: 'MATCHED',
        batchId,
        statementDate: bankDate,
        processedAt: new Date(),
      });

      // Denormalize onto Payment for backward compat
      payment.reconciliation = {
        status: 'MATCHED',
        bankStatementMatched: true,
        matchedAt: new Date(),
        bankReference: bankRef,
      };
      await payment.save();
      results.matched++;
    } else {
      // Partial match: same UTR but different amount
      const mismatch = await Payment.findOne({
        transactionId: String(record.utr).trim(),
      });

      if (mismatch) {
        await ReconciliationLog.create({
          bankReference: bankRef,
          bankAmount,
          bankDate,
          bankNarration: record.narration || '',
          matchedPaymentId: mismatch._id,
          matchedBookingId: mismatch.bookingId || null,
          matchType: 'AUTO_PARTIAL',
          confidence: 60,
          discrepancy: {
            hasDiscrepancy: true,
            type: 'AMOUNT_MISMATCH',
            expectedAmount: mismatch.amount,
            actualAmount: bankAmount,
            detail: `Bank amount ${bankAmount} does not match expected amount ${mismatch.amount}`,
          },
          status: 'DISCREPANCY',
          batchId,
          statementDate: bankDate,
          processedAt: new Date(),
        });

        // Denormalize onto Payment
        mismatch.reconciliation = {
          status: 'MISMATCH',
          bankStatementMatched: false,
          mismatchReason: `Bank amount ${bankAmount} does not match expected amount ${mismatch.amount}`,
        };
        await mismatch.save();
        results.mismatched++;
      } else {
        // Orphan bank transaction — no matching payment at all
        await ReconciliationLog.create({
          bankReference: bankRef,
          bankAmount,
          bankDate,
          bankNarration: record.narration || '',
          matchType: 'UNMATCHED',
          confidence: 0,
          discrepancy: {
            hasDiscrepancy: true,
            type: 'ORPHAN_BANK_TXN',
            actualAmount: bankAmount,
            detail: 'No matching payment found for this bank transaction',
          },
          status: 'DISCREPANCY',
          batchId,
          statementDate: bankDate,
          processedAt: new Date(),
        });
        results.notFound++;
      }
    }
  }

  return results;
}

/**
 * Get reconciliation stats from ReconciliationLog collection.
 */
async function getReconciliationStats() {
  const [byStatus, byMatchType, dailyTotals] = await Promise.all([
    ReconciliationLog.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$bankAmount' },
        },
      },
    ]),
    ReconciliationLog.aggregate([
      {
        $group: {
          _id: '$matchType',
          count: { $sum: 1 },
        },
      },
    ]),
    ReconciliationLog.aggregate([
      { $match: { status: 'MATCHED' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$processedAt' } },
          count: { $sum: 1 },
          totalAmount: { $sum: '$bankAmount' },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 30 },
    ]),
  ]);

  const stats = {
    matched: 0,
    mismatched: 0,
    unreconciled: 0,
    resolved: 0,
    matchedAmount: 0,
    mismatchedAmount: 0,
  };

  byStatus.forEach((s) => {
    if (s._id === 'MATCHED') {
      stats.matched = s.count;
      stats.matchedAmount = s.totalAmount;
    } else if (s._id === 'DISCREPANCY') {
      stats.mismatched = s.count;
      stats.mismatchedAmount = s.totalAmount;
    } else if (s._id === 'RESOLVED') {
      stats.resolved = s.count;
    } else if (s._id === 'PENDING') {
      stats.unreconciled = s.count;
    }
  });

  return { stats, byMatchType, dailyTotals };
}

/**
 * List reconciliation records from the ReconciliationLog collection.
 */
async function listByReconciliation({ reconStatus, page = 1, limit = 20 } = {}) {
  const q = {};
  if (reconStatus === 'MATCHED') q.status = 'MATCHED';
  else if (reconStatus === 'MISMATCH' || reconStatus === 'DISCREPANCY') q.status = 'DISCREPANCY';
  else if (reconStatus === 'UNRECONCILED') q.status = 'PENDING';
  else if (reconStatus === 'RESOLVED') q.status = 'RESOLVED';

  const skip = (page - 1) * limit;
  const [records, total] = await Promise.all([
    ReconciliationLog.find(q)
      .populate('matchedPaymentId', 'amount transactionId status userId type createdAt')
      .populate('matchedBookingId', 'bookingId status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ReconciliationLog.countDocuments(q),
  ]);

  return {
    records,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Resolve a discrepancy manually via admin action.
 * Updates the ReconciliationLog record AND the Payment.reconciliation
 * denormalized field.
 */
async function resolveDiscrepancy(recordId, { resolution, actor }) {
  // Try finding by ReconciliationLog _id first
  let logRecord = await ReconciliationLog.findById(recordId);

  // Fallback: if an old Payment ID is passed (backward compat), find the log by matchedPaymentId
  if (!logRecord) {
    logRecord = await ReconciliationLog.findOne({ matchedPaymentId: recordId });
  }

  if (!logRecord) throw err('Reconciliation record not found', 404);

  logRecord.status = 'RESOLVED';
  logRecord.resolvedBy = {
    adminId: actor.userId || null,
    adminName: actor.name || '',
    resolution: resolution || '',
    resolvedAt: new Date(),
  };
  await logRecord.save();

  // Also update Payment.reconciliation if linked
  if (logRecord.matchedPaymentId) {
    const payment = await Payment.findById(logRecord.matchedPaymentId);
    if (payment) {
      payment.reconciliation = payment.reconciliation || {};
      payment.reconciliation.status = 'MANUAL_OVERRIDE';
      payment.reconciliation.resolvedBy = actor;
      payment.reconciliation.resolvedAt = new Date();
      payment.reconciliation.resolution = resolution;
      await payment.save();
    }
  }

  return logRecord;
}

module.exports = {
  processBankStatement,
  getReconciliationStats,
  listByReconciliation,
  resolveDiscrepancy,
};
