'use strict';

/**
 * overdueMarker — R5.2: Auto-marks overdue phases.
 *
 * Daily cron (00:30 AM IST) that scans all active PaymentPlans for phases
 * where status='pending' and dueDate < today, transitioning them to 'overdue'.
 * Emits socket events for real-time admin awareness.
 */

const cron        = require('node-cron');
const PaymentPlan = require('../models/PaymentPlan');
const AuditLog    = require('../models/AuditLog');
const { emitToAdmins, emitToUser } = require('../services/socket-service');

async function runOverdueMarker() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log(`[overdueMarker] Running at ${new Date().toISOString()}`);

  let plans;
  try {
    plans = await PaymentPlan.find({
      status: 'active',
      'phases.status': 'pending',
      'phases.dueDate': { $ne: null, $lt: today },
    });
  } catch (err) {
    console.error('[overdueMarker] Query failed:', err.message);
    return { processed: 0, marked: 0, errors: 1 };
  }

  let marked = 0;
  let errors = 0;

  for (const plan of plans) {
    try {
      let changed = false;
      for (const phase of plan.phases) {
        if (phase.status === 'pending' && phase.dueDate && phase.dueDate < today) {
          phase.status = 'overdue';
          changed = true;

          emitToUser(String(plan.userId), 'payment:phase_overdue', {
            planId:      plan._id,
            userId:      plan.userId,
            phaseNumber: phase.phaseNumber,
            dueDate:     phase.dueDate,
            finalAmount: phase.finalAmount,
            daysOverdue: Math.floor((today - phase.dueDate) / 86400000),
          });

          emitToAdmins('payment:phase_overdue', {
            planId:      plan._id,
            userId:      plan.userId,
            phaseNumber: phase.phaseNumber,
            dueDate:     phase.dueDate,
            finalAmount: phase.finalAmount,
          });

          marked += 1;
        }
      }

      if (changed) {
        await plan.save();

        await AuditLog.create({
          userId:    null,
          userName:  'SYSTEM',
          userRole:  'system',
          action:    'PHASE_AUTO_OVERDUE',
          resource:  'payment_plan',
          resourceId: String(plan._id),
          method:    'CRON',
          path:      'jobs/overdueMarker',
          requestBody: {
            userId: plan.userId,
            phases: plan.phases
              .filter((p) => p.status === 'overdue')
              .map((p) => ({ phaseNumber: p.phaseNumber, dueDate: p.dueDate })),
          },
          statusCode: 200,
        });
      }
    } catch (err) {
      errors += 1;
      console.error(`[overdueMarker] Error on plan ${plan._id}:`, err.message);
    }
  }

  const summary = { processed: plans.length, marked, errors };
  console.log(`[overdueMarker] Done — ${JSON.stringify(summary)}`);
  return summary;
}

function registerOverdueMarker() {
  // Run daily at 00:30 AM IST
  cron.schedule('30 0 * * *', async () => {
    try {
      await runOverdueMarker();
    } catch (err) {
      console.error('[overdueMarker] Cron error:', err.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  console.log('[overdueMarker] Registered — runs daily at 00:30 AM IST');
}

module.exports = {
  runOverdueMarker,
  registerOverdueMarker,
};
