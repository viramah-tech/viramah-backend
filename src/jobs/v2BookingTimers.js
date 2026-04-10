'use strict';

/**
 * v2BookingTimers.js — Phase 6: Automated Background Tasks
 * 
 * Uses node-cron to implement the V2.0 scheduled logic.
 * - checkFinalPaymentTimers: Monitors BOOKING_CONFIRMED/FINAL_PAYMENT_PENDING records and transitions to OVERDUE if the timer expires. Integrates Phase 7.2 Immutability.
 * - partialPaymentReminder: Scans active installments across DUAL tracking architectures.
 */

const cron = require('node-cron');
const Booking = require('../models/Booking');
const AuditLog = require('../models/AuditLog');
const { sendEmail } = require('../services/emailService');

function formatCurrency(amount) {
  return `₹${(amount || 0).toLocaleString('en-IN')}`;
}

async function runCheckFinalPaymentTimers() {
  console.log(`[v2BookingTimers: FinalPayment] Running at ${new Date().toISOString()}`);
  const now = new Date();
  
  // Find bookings where finalPaymentDeadline is passed AND it is not paused
  const bookings = await Booking.find({
    status: { $in: ['BOOKING_CONFIRMED', 'FINAL_PAYMENT_PENDING'] },
    'timers.finalPaymentDeadline': { $lt: now, $ne: null },
    'timers.finalPaymentDeadlinePaused': null
  }).populate('userId', 'name email');

  let processed = 0;
  let errors = 0;

  for (const booking of bookings) {
    try {
      const prevStatus = booking.status;
      booking.status = 'OVERDUE';
      booking.statusHistory.push({
        status: 'OVERDUE',
        changedBy: 'SYSTEM',
        reason: 'Final payment deadline expired naturally',
        timestamp: now
      });

      await booking.save();

      // Phase 7.2: Immutable Audit Log Implementation
      await AuditLog.create({
        entityType: 'Booking',
        entityId: booking.bookingId,
        actionCategory: 'TIMER',
        action: 'FINAL_PAYMENT_OVERDUE',
        actor: {
          type: 'CRON',
          id: 'SYSTEM',
          name: 'Scheduled Job Runner'
        },
        changes: {
          field: 'status',
          from: prevStatus,
          to: 'OVERDUE'
        },
        severity: 'WARNING',
        snapshot: {
          after: {
            status: booking.status,
            finalPaymentDeadline: booking.timers.finalPaymentDeadline
          }
        }
      });

      // Fire notification
      if (booking.userId && booking.userId.email) {
        await sendEmail({
          to: booking.userId.email,
          subject: '⚠️ Final Payment Deadline Expired',
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>Action Required: Booking Overdue</h2>
              <p>Hi ${booking.userId.name.split(' ')[0]},</p>
              <p>The deadline to finalize your track selection and complete the payment for booking <strong>${booking.bookingId}</strong> has expired.</p>
              <p>Your booking status is currently marked as <strong>OVERDUE</strong>.</p>
              <p>If you fail to reconcile your account, your booking may be permanently cancelled.</p>
            </div>
          `
        });
      }

      processed++;
    } catch (e) {
      console.error(`[v2BookingTimers] Failed to process booking ${booking._id}:`, e);
      errors++;
    }
  }

  return { processed, errors };
}

async function runPartialPaymentReminders() {
  console.log(`[v2BookingTimers: PartialPaymentReminders] Running at ${new Date().toISOString()}`);
  const now = new Date();
  
  // For partial payments, we want bookings that are in a partially paid state
  const bookings = await Booking.find({
    status: { $in: ['FINAL_PAYMENT_PENDING', 'PARTIALLY_PAID'] },
  }).populate('userId', 'name email');

  let reminded = 0;
  let errors = 0;

  for (const booking of bookings) {
    try {
      if (!booking.installments || booking.installments.length === 0) continue;

      for (const inst of booking.installments) {
        if (inst.status === 'PENDING' || inst.status === 'PARTIALLY_PAID') {
          if (inst.dueDate && inst.amountRemaining > 0) {
            const daysRemaining = Math.round((inst.dueDate - now) / 86400000);

            // Remind at 3 days, 1 day, and exact day
            if ([3, 1, 0].includes(daysRemaining)) {
              if (booking.userId && booking.userId.email) {
                await sendEmail({
                  to: booking.userId.email,
                  subject: `Payment Reminder: Installment ${inst.installmentNumber} due ${daysRemaining === 0 ? 'today' : 'in ' + daysRemaining + ' days'}`,
                  html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px;">
                      <h2>Installment ${inst.installmentNumber} Reminder</h2>
                      <p>Hi ${booking.userId.name.split(' ')[0]},</p>
                      <p>You have a pending balance of <strong>${formatCurrency(inst.amountRemaining)}</strong> out of ${formatCurrency(inst.totalAmount)} for your booking <strong>${booking.bookingId}</strong>.</p>
                      <p>Please log in and submit the remaining payment to avoid any late fees.</p>
                    </div>
                  `
                });
                reminded++;
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`[v2BookingTimers] Failed reminder for booking ${booking._id}:`, e);
      errors++;
    }
  }

  return { reminded, errors };
}

function registerV2BookingTimers() {
  // Check timers every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await runCheckFinalPaymentTimers();
    } catch (err) {
      console.error('[v2BookingTimers] Cron FinalPayment error:', err.message);
    }
  }, { scheduled: true, timezone: 'Asia/Kolkata' });

  // Send daily reminders at 09:00 AM IST
  cron.schedule('0 9 * * *', async () => {
    try {
      await runPartialPaymentReminders();
    } catch (err) {
      console.error('[v2BookingTimers] Cron PartialPayment error:', err.message);
    }
  }, { scheduled: true, timezone: 'Asia/Kolkata' });

  console.log('[v2BookingTimers] V2 Timer jobs registered.');
}

module.exports = {
  runCheckFinalPaymentTimers,
  runPartialPaymentReminders,
  registerV2BookingTimers
};
