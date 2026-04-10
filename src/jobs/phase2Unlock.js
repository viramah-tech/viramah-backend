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
const { computePhaseAmount } = require('../services/adjustment-engine');
const { emitToUser } = require('../services/socket-service');

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

      // R5.5: Send Phase 2 unlock email notification (non-blocking)
      try {
        const User = require('../models/User');
        const user = await User.findById(plan.userId).select('name email userId').lean();
        if (user?.email) {
          const { sendEmail } = require('../services/email-service');
          const firstName = (user.name || 'there').split(' ')[0];
          const dueDateStr = phase2.dueDate
            ? new Date(phase2.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
            : 'soon';
          await sendEmail({
            to: user.email,
            subject: 'Phase 2 Payment Now Due — Viramah Student Living',
            html: `
            <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
              <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); border-radius: 12px; padding: 32px; color: #fff; margin-bottom: 24px;">
                <h1 style="margin: 0 0 8px; font-size: 22px;">Phase 2 Payment Unlocked</h1>
                <p style="margin: 0; opacity: 0.8;">Viramah Student Living</p>
              </div>
              <div style="padding: 0 8px;">
                <p style="font-size: 16px; color: #334155;">Hi ${firstName},</p>
                <p style="font-size: 15px; color: #475569; line-height: 1.6;">
                  Your <strong>Phase 2 payment</strong> is now active. Please pay
                  <strong style="color: #0f766e;">₹${(computed.finalAmount || 0).toLocaleString('en-IN')}</strong>
                  by <strong>${dueDateStr}</strong>.
                </p>
                <p style="font-size: 15px; color: #475569;">
                  Submit your payment along with the transaction receipt through the app.
                </p>
                <div style="margin: 24px 0; text-align: center;">
                  <a href="${process.env.FRONTEND_URL || 'https://app.viramahstay.com'}/user-onboarding"
                     style="display: inline-block; background: #0f766e; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
                    Make Payment →
                  </a>
                </div>
              </div>
              <div style="border-top: 1px solid #e2e8f0; margin-top: 32px; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center;">
                Viramah Student Living
              </div>
            </div>`,
          });
        }
      } catch (emailErr) {
        console.error(`[phase2Unlock] Email notification failed for plan ${plan._id} (non-fatal):`, emailErr.message);
      }

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
