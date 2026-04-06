'use strict';

/**
 * Phase 2 Unlock Scheduler — Plan Section 8.
 *
 * A daily background job (00:01 AM) that checks all payment plans with a locked
 * Phase 2 whose dueDate has arrived, unlocks them, recomputes fresh amounts
 * from the adjustmentEngine, emits socket events, and writes audit logs.
 *
 * Error isolation: one failed plan must NOT stop the rest.
 */

const cron = require('node-cron');
const PaymentPlan = require('../models/PaymentPlan');
const AuditLog    = require('../models/AuditLog');
const { computePhaseAmount } = require('../services/adjustmentEngine');
const { emitToUser } = require('../services/socketService');

/**
 * Core unlock logic — exported so it can be triggered manually for testing.
 */
async function runPhase2UnlockJob() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log(`[phase2Unlock] Running at ${new Date().toISOString()} — checking for dueDate <= ${today.toISOString()}`);

  let plans;
  try {
    plans = await PaymentPlan.find({
      'phases.phaseNumber': 2,
      'phases.status': 'locked',
      'phases.dueDate': { $ne: null, $lte: today },
    });
  } catch (err) {
    console.error('[phase2Unlock] Failed to query plans:', err.message);
    return { processed: 0, unlocked: 0, errors: 1 };
  }

  console.log(`[phase2Unlock] Found ${plans.length} plan(s) to process`);

  let unlocked = 0;
  let errors   = 0;

  for (const plan of plans) {
    try {
      const phase2 = plan.phases.find((p) => p.phaseNumber === 2);
      if (!phase2 || phase2.status !== 'locked') continue;

      // Recompute phase amount fresh — discount may have changed since plan was created
      const computed = await computePhaseAmount(plan._id, 2, plan.userId);

      // Update phase snapshot with fresh values
      phase2.finalAmount    = computed.finalAmount;
      phase2.grossRent      = computed.grossRent;
      phase2.discountRate   = computed.discountRate;
      phase2.discountAmount = computed.discountAmount;
      phase2.netRent        = computed.netRent;
      phase2.nonRentalTotal = computed.nonRentalTotal;
      phase2.advanceCreditApplied = computed.advanceCreditApplied;
      phase2.breakdown      = computed.breakdown;
      phase2.status         = 'pending';

      await plan.save();

      // Emit socket event to user
      emitToUser(String(plan.userId), 'payment:phase2_unlocked', {
        planId:      plan._id,
        userId:      plan.userId,
        phaseNumber: 2,
        dueDate:     phase2.dueDate,
        finalAmount: computed.finalAmount,
      });

      // Audit log
      await AuditLog.create({
        userId:    null,
        userName:  'SYSTEM',
        userRole:  'system',
        action:    'PHASE2_AUTO_UNLOCKED',
        resource:  'payment_plan',
        resourceId: String(plan._id),
        method:    'CRON',
        path:      'jobs/phase2Unlock',
        requestBody: { dueDate: phase2.dueDate, finalAmount: computed.finalAmount },
        statusCode: 200,
      });

      unlocked += 1;
      console.log(`[phase2Unlock] Unlocked plan ${plan.planId || plan._id} for user ${plan.userId}`);
    } catch (err) {
      errors += 1;
      console.error(`[phase2Unlock] Error unlocking plan ${plan._id}:`, err.message);
    }
  }

  const summary = { processed: plans.length, unlocked, errors };
  console.log(`[phase2Unlock] Done — ${JSON.stringify(summary)}`);
  return summary;
}

/**
 * Register the cron schedule. Call once at server startup.
 * Runs daily at 00:01 AM server time.
 */
function registerPhase2UnlockJob() {
  cron.schedule('1 0 * * *', async () => {
    try {
      await runPhase2UnlockJob();
    } catch (err) {
      console.error('[phase2Unlock] Top-level cron error:', err.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata', // IST
  });

  console.log('[phase2Unlock] Cron job registered — runs daily at 00:01 AM IST');
}

module.exports = {
  runPhase2UnlockJob,
  registerPhase2UnlockJob,
};
