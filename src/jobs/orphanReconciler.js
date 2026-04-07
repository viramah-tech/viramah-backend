'use strict';

/**
 * orphanReconciler — C2 FIX: Detects and repairs payments approved without
 * a Transaction row (caused by crash during the non-atomic 9-step approve flow).
 *
 * Runs on server startup + daily at 02:00 AM IST.
 * If an orphan is found, creates the missing Transaction and links it.
 */

const cron       = require('node-cron');
const Payment    = require('../models/Payment');
const Transaction = require('../models/Transaction');
const AuditLog   = require('../models/AuditLog');

/**
 * Core reconciliation logic.
 * Finds approved payments with no transactionRef and creates missing Transaction rows.
 */
async function runOrphanReconciler() {
  console.log(`[orphanReconciler] Running at ${new Date().toISOString()}`);

  let orphans;
  try {
    orphans = await Payment.find({
      status: 'approved',
      transactionRef: null,
    });
  } catch (err) {
    console.error('[orphanReconciler] Failed to query orphans:', err.message);
    return { processed: 0, repaired: 0, errors: 1 };
  }

  if (orphans.length === 0) {
    console.log('[orphanReconciler] No orphan payments found.');
    return { processed: 0, repaired: 0, errors: 0 };
  }

  console.warn(`[orphanReconciler] Found ${orphans.length} orphan payment(s) — repairing...`);

  let repaired = 0;
  let errors   = 0;

  for (const payment of orphans) {
    try {
      // Compute running balance
      const lastTxn = await Transaction.findOne({ userId: payment.userId })
        .sort({ createdAt: -1 });
      const balanceBefore = lastTxn?.balanceAfter ?? 0;
      const balanceAfter  = balanceBefore + (payment.amount || 0);

      // Create the missing Transaction
      const txn = await Transaction.create({
        paymentId:     payment._id,
        planId:        payment.planId || null,
        bookingId:     payment.bookingId || null,
        userId:        payment.userId,
        sourceType:    'payment',
        sourceId:      payment._id,
        direction:     'credit',
        type:          'credit',
        typeV2:        'rent',
        amount:        payment.amount,
        description:   `[RECONCILED] Payment ${payment.paymentType || 'legacy'} approved — orphan repair`,
        status:        'completed',
        postingStatus: 'posted',
        postedAt:      payment.reviewedAt || payment.updatedAt || new Date(),
        balanceBefore,
        balanceAfter,
        installmentNumber: payment.phaseNumber || payment.installmentNumber || null,
        isCorrectiveEntry: true,
      });

      // Link the Transaction back to the Payment
      payment.transactionRef = txn._id;
      await payment.save();

      // Audit trail
      await AuditLog.create({
        userId:    null,
        userName:  'SYSTEM',
        userRole:  'system',
        action:    'ORPHAN_PAYMENT_RECONCILED',
        resource:  'payment',
        resourceId: String(payment._id),
        method:    'CRON',
        path:      'jobs/orphanReconciler',
        requestBody: {
          paymentId: payment._id,
          transactionId: txn._id,
          amount: payment.amount,
        },
        statusCode: 200,
      });

      repaired += 1;
      console.log(`[orphanReconciler] Repaired payment ${payment.paymentId || payment._id} → txn ${txn.transactionId}`);
    } catch (err) {
      errors += 1;
      console.error(`[orphanReconciler] Failed to repair payment ${payment._id}:`, err.message);
    }
  }

  const summary = { processed: orphans.length, repaired, errors };
  console.log(`[orphanReconciler] Done — ${JSON.stringify(summary)}`);
  return summary;
}

/**
 * Register the cron schedule. Call once at server startup.
 * Also runs the reconciler immediately on startup.
 */
function registerOrphanReconciler() {
  // Run immediately on startup
  runOrphanReconciler().catch((err) =>
    console.error('[orphanReconciler] Startup run failed:', err.message)
  );

  // Schedule daily at 02:00 AM IST
  cron.schedule('0 2 * * *', async () => {
    try {
      await runOrphanReconciler();
    } catch (err) {
      console.error('[orphanReconciler] Cron error:', err.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  console.log('[orphanReconciler] Registered — runs on startup + daily at 02:00 AM IST');
}

module.exports = {
  runOrphanReconciler,
  registerOrphanReconciler,
};
