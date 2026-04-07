'use strict';

/**
 * paymentReminders — R5.1 + R5.5: Automated payment reminder emails.
 *
 * Daily cron (08:00 AM IST) that scans for:
 *   1. PaymentPlan phases with dueDate approaching (7, 3, 1 day before)
 *   2. RoomHolds with paymentDeadline approaching (7, 3, 1 day before)
 *   3. Overdue phases (1, 3, 7 days after)
 *
 * Sends email notifications via emailService with rich HTML templates.
 * Uses socket for real-time in-app push.
 */

const cron        = require('node-cron');
const PaymentPlan = require('../models/PaymentPlan');
const RoomHold    = require('../models/RoomHold');
const User        = require('../models/User');
const { sendEmail } = require('../services/emailService');
const { emitToUser } = require('../services/socketService');

// ── Reminder thresholds (days before due) ────────────────────────────────────
const UPCOMING_THRESHOLDS = [7, 3, 1];
const OVERDUE_THRESHOLDS  = [1, 3, 7];

// ── Helper ───────────────────────────────────────────────────────────────────
function daysUntil(date) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

function formatCurrency(amount) {
  return `₹${(amount || 0).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ── Email HTML builders ──────────────────────────────────────────────────────

function buildUpcomingReminderHtml({ firstName, phaseNumber, dueDate, amount, daysLeft }) {
  return `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
    <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); border-radius: 12px; padding: 32px; color: #fff; margin-bottom: 24px;">
      <h1 style="margin: 0 0 8px; font-size: 22px;">Payment Reminder</h1>
      <p style="margin: 0; opacity: 0.8;">Viramah Student Living</p>
    </div>
    <div style="padding: 0 8px;">
      <p style="font-size: 16px; color: #334155;">Hi ${firstName},</p>
      <p style="font-size: 15px; color: #475569; line-height: 1.6;">
        This is a friendly reminder that your <strong>Phase ${phaseNumber} payment</strong> of
        <strong style="color: #0f766e;">${formatCurrency(amount)}</strong> is due
        ${daysLeft === 0 ? '<strong style="color: #dc2626;">today</strong>' :
          daysLeft === 1 ? '<strong style="color: #ea580c;">tomorrow</strong>' :
          `in <strong>${daysLeft} days</strong>`}
        on <strong>${formatDate(dueDate)}</strong>.
      </p>
      <p style="font-size: 15px; color: #475569;">
        Please submit your payment along with the transaction receipt to avoid any delays.
      </p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${process.env.FRONTEND_URL || 'https://app.viramahstay.com'}/user-onboarding"
           style="display: inline-block; background: #0f766e; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
          Make Payment →
        </a>
      </div>
    </div>
    <div style="border-top: 1px solid #e2e8f0; margin-top: 32px; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center;">
      Viramah Student Living | This is an automated reminder.
    </div>
  </div>`;
}

function buildOverdueReminderHtml({ firstName, phaseNumber, dueDate, amount, daysOverdue }) {
  return `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
    <div style="background: linear-gradient(135deg, #991b1b 0%, #dc2626 100%); border-radius: 12px; padding: 32px; color: #fff; margin-bottom: 24px;">
      <h1 style="margin: 0 0 8px; font-size: 22px;">⚠️ Payment Overdue</h1>
      <p style="margin: 0; opacity: 0.8;">Viramah Student Living</p>
    </div>
    <div style="padding: 0 8px;">
      <p style="font-size: 16px; color: #334155;">Hi ${firstName},</p>
      <p style="font-size: 15px; color: #475569; line-height: 1.6;">
        Your <strong>Phase ${phaseNumber} payment</strong> of
        <strong style="color: #dc2626;">${formatCurrency(amount)}</strong> was due on
        <strong>${formatDate(dueDate)}</strong> and is now
        <strong style="color: #dc2626;">${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue</strong>.
      </p>
      <p style="font-size: 15px; color: #475569;">
        Please complete your payment immediately to avoid penalties and ensure continued access to your accommodation.
      </p>
      <div style="margin: 24px 0; text-align: center;">
        <a href="${process.env.FRONTEND_URL || 'https://app.viramahstay.com'}/user-onboarding"
           style="display: inline-block; background: #dc2626; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
          Pay Now →
        </a>
      </div>
    </div>
    <div style="border-top: 1px solid #e2e8f0; margin-top: 32px; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center;">
      Viramah Student Living | This is an automated reminder.
    </div>
  </div>`;
}

function buildDepositDeadlineHtml({ firstName, daysLeft, paymentDeadline, depositAmount }) {
  const urgencyColor = daysLeft <= 1 ? '#dc2626' : daysLeft <= 3 ? '#ea580c' : '#0f766e';
  return `
  <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
    <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); border-radius: 12px; padding: 32px; color: #fff; margin-bottom: 24px;">
      <h1 style="margin: 0 0 8px; font-size: 22px;">Deposit Deadline Reminder</h1>
      <p style="margin: 0; opacity: 0.8;">Viramah Student Living</p>
    </div>
    <div style="padding: 0 8px;">
      <p style="font-size: 16px; color: #334155;">Hi ${firstName},</p>
      <p style="font-size: 15px; color: #475569; line-height: 1.6;">
        Your room hold deposit of <strong>${formatCurrency(depositAmount)}</strong> will expire
        ${daysLeft === 0 ? '<strong style="color: #dc2626;">today</strong>' :
          daysLeft === 1 ? '<strong style="color: #ea580c;">tomorrow</strong>' :
          `in <strong style="color: ${urgencyColor};">${daysLeft} days</strong>`}
        on <strong>${formatDate(paymentDeadline)}</strong>.
      </p>
      <p style="font-size: 15px; color: #475569;">
        Please complete your full payment before the deadline to keep your room secured. If the deadline passes, your room hold will be released.
      </p>
    </div>
    <div style="border-top: 1px solid #e2e8f0; margin-top: 32px; padding-top: 16px; font-size: 12px; color: #94a3b8; text-align: center;">
      Viramah Student Living | This is an automated reminder.
    </div>
  </div>`;
}

// ── Core reminder logic ──────────────────────────────────────────────────────

async function runPaymentReminders() {
  console.log(`[paymentReminders] Running at ${new Date().toISOString()}`);
  let emailsSent = 0;
  let errors = 0;

  // ── 1. Upcoming phase payments ─────────────────────────────────────────────
  try {
    const plans = await PaymentPlan.find({ status: 'active' })
      .populate('userId', 'name email phone userId');

    for (const plan of plans) {
      const user = plan.userId;
      if (!user?.email) continue;
      const firstName = (user.name || 'there').split(' ')[0];

      for (const phase of plan.phases) {
        if (!phase.dueDate) continue;
        const dLeft = daysUntil(phase.dueDate);

        // Upcoming reminders
        if (phase.status === 'pending' && UPCOMING_THRESHOLDS.includes(dLeft)) {
          try {
            await sendEmail({
              to: user.email,
              subject: `Payment Reminder: Phase ${phase.phaseNumber} due ${dLeft === 0 ? 'today' : dLeft === 1 ? 'tomorrow' : `in ${dLeft} days`}`,
              html: buildUpcomingReminderHtml({
                firstName, phaseNumber: phase.phaseNumber,
                dueDate: phase.dueDate, amount: phase.finalAmount, daysLeft: dLeft,
              }),
            });
            emitToUser(String(plan.userId._id || plan.userId), 'payment:reminder', {
              type: 'upcoming', phaseNumber: phase.phaseNumber,
              dueDate: phase.dueDate, daysLeft: dLeft,
            });
            emailsSent += 1;
          } catch (e) {
            errors += 1;
            console.error(`[paymentReminders] Email failed for user ${user.userId}:`, e.message);
          }
        }

        // Overdue reminders
        if (phase.status === 'overdue' && OVERDUE_THRESHOLDS.includes(-dLeft)) {
          try {
            await sendEmail({
              to: user.email,
              subject: `⚠️ Payment Overdue: Phase ${phase.phaseNumber} — ${-dLeft} day${-dLeft > 1 ? 's' : ''} past due`,
              html: buildOverdueReminderHtml({
                firstName, phaseNumber: phase.phaseNumber,
                dueDate: phase.dueDate, amount: phase.finalAmount, daysOverdue: -dLeft,
              }),
            });
            emitToUser(String(plan.userId._id || plan.userId), 'payment:reminder', {
              type: 'overdue', phaseNumber: phase.phaseNumber,
              dueDate: phase.dueDate, daysOverdue: -dLeft,
            });
            emailsSent += 1;
          } catch (e) {
            errors += 1;
            console.error(`[paymentReminders] Overdue email failed for user ${user.userId}:`, e.message);
          }
        }
      }
    }
  } catch (err) {
    errors += 1;
    console.error('[paymentReminders] Phase reminders failed:', err.message);
  }

  // ── 2. Deposit deadline reminders ──────────────────────────────────────────
  try {
    const holds = await RoomHold.find({ status: 'active', paymentDeadline: { $ne: null } })
      .populate('userId', 'name email userId');

    for (const hold of holds) {
      const user = hold.userId;
      if (!user?.email) continue;

      const dLeft = daysUntil(hold.paymentDeadline);
      if (UPCOMING_THRESHOLDS.includes(dLeft)) {
        try {
          const firstName = (user.name || 'there').split(' ')[0];
          await sendEmail({
            to: user.email,
            subject: `Room Hold Expiring ${dLeft === 0 ? 'Today' : dLeft === 1 ? 'Tomorrow' : `in ${dLeft} Days`} — Complete Your Payment`,
            html: buildDepositDeadlineHtml({
              firstName, daysLeft: dLeft,
              paymentDeadline: hold.paymentDeadline,
              depositAmount: hold.depositAmount,
            }),
          });
          emitToUser(String(user._id), 'deposit:deadline_reminder', {
            daysLeft: dLeft, paymentDeadline: hold.paymentDeadline,
          });
          emailsSent += 1;
        } catch (e) {
          errors += 1;
          console.error(`[paymentReminders] Deposit reminder failed for ${user.userId}:`, e.message);
        }
      }
    }
  } catch (err) {
    errors += 1;
    console.error('[paymentReminders] Deposit reminders failed:', err.message);
  }

  const summary = { emailsSent, errors };
  console.log(`[paymentReminders] Done — ${JSON.stringify(summary)}`);
  return summary;
}

function registerPaymentReminders() {
  // Run daily at 08:00 AM IST
  cron.schedule('0 8 * * *', async () => {
    try {
      await runPaymentReminders();
    } catch (err) {
      console.error('[paymentReminders] Cron error:', err.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  console.log('[paymentReminders] Registered — runs daily at 08:00 AM IST');
}

module.exports = {
  runPaymentReminders,
  registerPaymentReminders,
};
