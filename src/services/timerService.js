'use strict';

/**
 * timerService.js — Manages system timers for the booking and payment lifecycle
 * Uses Redis + BullMQ for precise timing, falls back to MongoDB fields for polling
 */

const { getQueue, QUEUES } = require('../config/queue');
const Booking = require('../models/Booking');
const AuditLog = require('../models/AuditLog');

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

// Helper to push to queue if available
const scheduleJob = async (queueName, jobName, payload, delayMs) => {
  try {
    const queue = getQueue(queueName);
    return await queue.add(jobName, payload, { delay: delayMs, jobId: `${jobName}:${payload.bookingId || payload.paymentId}` });
  } catch (e) {
    console.warn(`[timerService] Failed to schedule ${jobName} on ${queueName} (fallback to polling)`, e.message);
    return null;
  }
};

const cancelJob = async (queueName, jobName, id) => {
  try {
    const queue = getQueue(queueName);
    const jobId = `${jobName}:${id}`;
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  } catch (e) {
    console.warn(`[timerService] Failed to cancel ${jobName} on ${queueName}`, e.message);
  }
};

/**
 * Starts a 15-minute price lock from booking creation.
 * If payment is not initiated within this window, the booking expires.
 */
async function startPriceLock(bookingId, minutes = 15) {
  const expiryDate = new Date(Date.now() + minutes * 60 * 1000);
  
  await Booking.findByIdAndUpdate(bookingId, {
    'timers.priceLockExpiry': expiryDate
  });

  await scheduleJob(QUEUES.TIMER_EXPIRY, 'price-lock', { bookingId }, minutes * 60 * 1000);
  return expiryDate;
}

/**
 * Starts a 30-minute window for proof-of-payment submission.
 */
async function startPaymentWindow(bookingId, minutes = 30) {
  const expiryDate = new Date(Date.now() + minutes * 60 * 1000);
  
  await Booking.findByIdAndUpdate(bookingId, {
    'timers.bookingPaymentExpiry': expiryDate
  });

  await scheduleJob(QUEUES.TIMER_EXPIRY, 'payment-window', { bookingId }, minutes * 60 * 1000);
  return expiryDate;
}

/**
 * Starts the 7-day final payment timer.
 * Schedules reminders too.
 */
async function startFinalPaymentTimer(bookingId, days = 7) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);
  
  await Booking.findByIdAndUpdate(bookingId, {
    'timers.finalPaymentDeadline': expiryDate
  });

  // Schedule expiry
  await scheduleJob(QUEUES.TIMER_EXPIRY, 'final-payment-deadline', { bookingId }, days * 24 * 60 * 60 * 1000);

  // Schedule Reminders (D-3, D-1)
  if (days > 3) {
    await scheduleJob(QUEUES.NOTIFICATIONS, 'reminder-d3', { bookingId }, (days - 3) * 24 * 60 * 60 * 1000);
  }
  if (days > 1) {
    await scheduleJob(QUEUES.NOTIFICATIONS, 'reminder-d1', { bookingId }, (days - 1) * 24 * 60 * 60 * 1000);
  }

  return expiryDate;
}

/**
 * Admin action to extend the 7-day timer.
 */
async function extendTimer(bookingId, adminActor, { additionalDays, reason }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  if (!booking.timers.finalPaymentDeadline) {
    throw err('No active final payment timer to extend', 400);
  }

  // Cancel old jobs
  await cancelTimer(bookingId, 'final-payment-deadline');
  await cancelTimer(bookingId, 'reminder-d3');
  await cancelTimer(bookingId, 'reminder-d1');

  const newExpiryDate = new Date(booking.timers.finalPaymentDeadline);
  newExpiryDate.setDate(newExpiryDate.getDate() + additionalDays);
  
  booking.timers.finalPaymentDeadline = newExpiryDate;
  await booking.save();

  const now = Date.now();
  const timeUntilExpiryMs = newExpiryDate.getTime() - now;

  if (timeUntilExpiryMs > 0) {
    await scheduleJob(QUEUES.TIMER_EXPIRY, 'final-payment-deadline', { bookingId }, timeUntilExpiryMs);
    const daysRemaining = timeUntilExpiryMs / (24 * 60 * 60 * 1000);
    if (daysRemaining > 3) {
      await scheduleJob(QUEUES.NOTIFICATIONS, 'reminder-d3', { bookingId }, timeUntilExpiryMs - (3 * 24 * 60 * 60 * 1000));
    }
    if (daysRemaining > 1) {
      await scheduleJob(QUEUES.NOTIFICATIONS, 'reminder-d1', { bookingId }, timeUntilExpiryMs - (1 * 24 * 60 * 60 * 1000));
    }
  }

  await AuditLog.create({
    userId: adminActor?.userId || null,
    userName: adminActor?.name || 'System',
    userRole: adminActor?.role || 'admin',
    action: 'TIMER_EXTENDED',
    actionCategory: 'TIMER',
    entityType: 'BOOKING',
    entityId: String(bookingId),
    changes: { field: 'finalPaymentDeadline', from: booking.timers.finalPaymentDeadline, to: newExpiryDate },
    notes: reason || 'Admin extended payment deadline'
  });

  return newExpiryDate;
}

/**
 * Calculate the remaining time in seconds for active timers.
 */
async function getTimerStatus(bookingId) {
  const booking = await Booking.findById(bookingId).select('timers status');
  if (!booking) return null;

  const now = Date.now();
  const status = {
    priceLockRemaining: 0,
    paymentWindowRemaining: 0,
    finalPaymentRemaining: 0,
  };

  if (booking.timers.priceLockExpiry) {
    status.priceLockRemaining = Math.max(0, Math.floor((booking.timers.priceLockExpiry.getTime() - now) / 1000));
  }
  if (booking.timers.bookingPaymentExpiry) {
    status.paymentWindowRemaining = Math.max(0, Math.floor((booking.timers.bookingPaymentExpiry.getTime() - now) / 1000));
  }
  if (booking.timers.finalPaymentDeadline) {
    status.finalPaymentRemaining = Math.max(0, Math.floor((booking.timers.finalPaymentDeadline.getTime() - now) / 1000));
  }

  return status;
}

/**
 * Remove a timer and clear its scheduled jobs.
 */
async function cancelTimer(bookingId, timerType) {
  let unsetTarget = null;
  if (timerType === 'price-lock') unsetTarget = 'timers.priceLockExpiry';
  else if (timerType === 'payment-window') unsetTarget = 'timers.bookingPaymentExpiry';
  else if (timerType === 'final-payment-deadline') unsetTarget = 'timers.finalPaymentDeadline';

  if (unsetTarget) {
    await Booking.findByIdAndUpdate(bookingId, { $unset: { [unsetTarget]: 1 } });
  }

  await cancelJob(QUEUES.TIMER_EXPIRY, timerType, bookingId);
}

module.exports = {
  startPriceLock,
  startPaymentWindow,
  startFinalPaymentTimer,
  extendTimer,
  getTimerStatus,
  cancelTimer
};
