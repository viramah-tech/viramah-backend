'use strict';

/**
 * timerAdminService.js — V2.0 Flexible Timer Controls.
 *
 * Admin can control ALL timers: extend, reduce, pause, resume.
 * Every operation creates an audit trail in booking.timers.adminOverrides[].
 */

const Booking = require('../models/Booking');
const AuditLog = require('../models/AuditLog');
const { getPricingConfig } = require('./pricing-service');

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

// Valid timer types that admins can control
const VALID_TIMER_TYPES = [
  'finalPaymentDeadline',
  'bookingPaymentExpiry',
  'priceLockExpiry',
];

/**
 * Extend a timer by N days.
 */
async function extendTimer(bookingId, timerType, additionalDays, adminId, reason) {
  validateTimerType(timerType);
  if (additionalDays <= 0) throw err('Additional days must be positive', 400);

  const cfg = await getPricingConfig();
  const maxExtend = cfg.timers?.maxExtendDays || 14;
  if (additionalDays > maxExtend) {
    throw err(`Cannot extend more than ${maxExtend} days`, 400);
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  const currentDeadline = booking.timers[timerType];
  if (!currentDeadline) throw err(`Timer ${timerType} is not set`, 400);

  const newDeadline = new Date(currentDeadline);
  newDeadline.setDate(newDeadline.getDate() + additionalDays);

  return applyTimerChange(booking, timerType, newDeadline, adminId, reason, 'EXTEND');
}

/**
 * Reduce a timer by N days.
 * Cannot set deadline to past.
 */
async function reduceTimer(bookingId, timerType, reduceDays, adminId, reason) {
  validateTimerType(timerType);
  if (reduceDays <= 0) throw err('Reduce days must be positive', 400);

  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  const currentDeadline = booking.timers[timerType];
  if (!currentDeadline) throw err(`Timer ${timerType} is not set`, 400);

  const newDeadline = new Date(currentDeadline);
  newDeadline.setDate(newDeadline.getDate() - reduceDays);

  // Safety: cannot set to past (give at least 1 hour grace)
  const minDate = new Date(Date.now() + 60 * 60 * 1000);
  if (newDeadline < minDate) {
    throw err('Cannot reduce timer to past or less than 1 hour from now', 400);
  }

  return applyTimerChange(booking, timerType, newDeadline, adminId, reason, 'REDUCE');
}

/**
 * Pause a timer. Stores remaining time and clears the active deadline.
 */
async function pauseTimer(bookingId, timerType, adminId, reason) {
  validateTimerType(timerType);

  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  const currentDeadline = booking.timers[timerType];
  if (!currentDeadline) throw err(`Timer ${timerType} is not set`, 400);

  // Check if already paused
  const pauseKey = `${timerType}Paused`;
  if (booking.timers[pauseKey]?.pausedAt) {
    throw err(`Timer ${timerType} is already paused`, 400);
  }

  const remainingMs = new Date(currentDeadline).getTime() - Date.now();
  if (remainingMs <= 0) {
    throw err('Timer has already expired, cannot pause', 400);
  }

  // Store pause state
  booking.timers[pauseKey] = {
    pausedAt: new Date(),
    remainingMs,
  };

  // Record the override
  booking.timers.adminOverrides.push({
    action: 'PAUSE',
    timerType,
    previousValue: currentDeadline,
    newValue: null,
    adminId,
    reason: reason || 'Timer paused',
    timestamp: new Date(),
  });

  // Clear the active deadline
  booking.timers[timerType] = null;

  booking.statusHistory.push({
    status: booking.status,
    changedBy: adminId,
    reason: `Timer ${timerType} paused: ${reason || ''}`,
  });

  await booking.save();

  // Phase 7.2 Immutability Audit Log
  await AuditLog.create({
    entityType: 'Booking',
    entityId: booking.bookingId,
    actionCategory: 'TIMER',
    action: `TIMER_PAUSED`,
    actor: {
      type: 'ADMIN',
      id: adminId,
      name: 'Admin User' // Can lookup if necessary
    },
    changes: {
      field: timerType,
      previousValue: currentDeadline,
      newValue: 'PAUSED',
      reason: reason || 'Timer paused'
    },
    severity: 'INFO',
    snapshot: {
      before: { [timerType]: currentDeadline },
      after: { [timerType]: 'PAUSED' }
    }
  });

  return {
    timerType,
    action: 'PAUSE',
    status: 'PAUSED',
    remainingMs,
    remainingHuman: formatMs(remainingMs),
  };
}

/**
 * Resume a paused timer. Restores the remaining time from pause state.
 */
async function resumeTimer(bookingId, timerType, adminId, reason) {
  validateTimerType(timerType);

  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  const pauseKey = `${timerType}Paused`;
  const pauseInfo = booking.timers[pauseKey];

  if (!pauseInfo?.pausedAt) {
    throw err(`Timer ${timerType} is not paused`, 400);
  }

  // Restore: set new deadline = now + remaining time
  const newDeadline = new Date(Date.now() + pauseInfo.remainingMs);
  booking.timers[timerType] = newDeadline;

  // Clear pause state
  booking.timers[pauseKey] = { pausedAt: null, remainingMs: null };

  // Record the override
  booking.timers.adminOverrides.push({
    action: 'RESUME',
    timerType,
    previousValue: null,
    newValue: newDeadline,
    adminId,
    reason: reason || 'Timer resumed',
    timestamp: new Date(),
  });

  booking.statusHistory.push({
    status: booking.status,
    changedBy: adminId,
    reason: `Timer ${timerType} resumed: ${reason || ''}`,
  });

  await booking.save();

  // Phase 7.2 Immutability Audit Log
  await AuditLog.create({
    entityType: 'Booking',
    entityId: booking.bookingId,
    actionCategory: 'TIMER',
    action: `TIMER_RESUMED`,
    actor: {
      type: 'ADMIN',
      id: adminId,
      name: 'Admin User'
    },
    changes: {
      field: timerType,
      previousValue: 'PAUSED',
      newValue: newDeadline,
      reason: reason || 'Timer resumed'
    },
    severity: 'INFO',
    snapshot: {
      before: { [timerType]: 'PAUSED' },
      after: { [timerType]: newDeadline }
    }
  });

  return {
    timerType,
    action: 'RESUME',
    newDeadline,
    remainingMs: pauseInfo.remainingMs,
    remainingHuman: formatMs(pauseInfo.remainingMs),
  };
}

/**
 * Get timer status for a booking (admin view).
 */
async function getTimerOverview(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  const cfg = await getPricingConfig();
  const timers = {};

  for (const timerType of VALID_TIMER_TYPES) {
    const deadline = booking.timers[timerType];
    const pauseKey = `${timerType}Paused`;
    const isPaused = !!booking.timers[pauseKey]?.pausedAt;

    if (deadline || isPaused) {
      const remainingMs = deadline ? new Date(deadline).getTime() - Date.now() : null;
      timers[timerType] = {
        deadline,
        status: isPaused ? 'PAUSED' : (remainingMs > 0 ? 'ACTIVE' : 'EXPIRED'),
        timeRemaining: isPaused
          ? formatMs(booking.timers[pauseKey].remainingMs)
          : (remainingMs > 0 ? formatMs(remainingMs) : 'Expired'),
        remainingMs: isPaused ? booking.timers[pauseKey].remainingMs : remainingMs,
      };
    }
  }

  // Installment deadlines
  if (booking.timers.installmentDeadlines?.length > 0) {
    timers.installments = booking.timers.installmentDeadlines.map(d => ({
      installmentNumber: d.installmentNumber,
      deadline: d.deadline,
      remaining: formatMs(new Date(d.deadline).getTime() - Date.now()),
    }));
  }

  return {
    bookingId: booking.bookingId,
    timers,
    adminOverrides: booking.timers.adminOverrides || [],
    controls: {
      canExtend: true,
      canReduce: true,
      canPause: true,
      maxExtendDays: cfg.timers?.maxExtendDays || 14,
    },
  };
}

/* ─── Internal Helpers ────────────────────────────────────────────────────── */

async function applyTimerChange(booking, timerType, newDeadline, adminId, reason, action) {
  const previousValue = booking.timers[timerType];

  booking.timers[timerType] = newDeadline;
  booking.timers.adminOverrides.push({
    action,
    timerType,
    previousValue,
    newValue: newDeadline,
    adminId,
    reason: reason || '',
    timestamp: new Date(),
  });

  // If booking was OVERDUE and we're extending, revert status
  if (action === 'EXTEND' && booking.status === 'OVERDUE' && timerType === 'finalPaymentDeadline') {
    booking.status = 'FINAL_PAYMENT_PENDING';
    booking.statusHistory.push({
      status: 'FINAL_PAYMENT_PENDING',
      changedBy: adminId,
      reason: `Reverted from OVERDUE: ${reason}`,
    });
  }

  booking.statusHistory.push({
    status: booking.status,
    changedBy: adminId,
    reason: `Timer ${timerType} ${action.toLowerCase()}ed: ${reason || ''}`,
  });

  await booking.save();

  // Phase 7.2 Immutability Audit Log
  await AuditLog.create({
    entityType: 'Booking',
    entityId: booking.bookingId,
    actionCategory: 'TIMER',
    action: `TIMER_${action}`,
    actor: {
      type: 'ADMIN',
      id: adminId,
      name: 'Admin User'
    },
    changes: {
      field: timerType,
      previousValue: previousValue,
      newValue: newDeadline,
      reason: reason || ''
    },
    severity: 'INFO',
    snapshot: {
      before: { [timerType]: previousValue },
      after: { [timerType]: newDeadline }
    }
  });

  return {
    timerType,
    action,
    previousDeadline: previousValue,
    newDeadline,
  };
}

function validateTimerType(timerType) {
  if (!VALID_TIMER_TYPES.includes(timerType)) {
    throw err(`Invalid timer type: ${timerType}. Valid types: ${VALID_TIMER_TYPES.join(', ')}`, 400);
  }
}

function formatMs(ms) {
  if (!ms || ms <= 0) return 'Expired';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  return parts.join(' ') || '< 1 minute';
}

module.exports = {
  extendTimer,
  reduceTimer,
  pauseTimer,
  resumeTimer,
  getTimerOverview,
};
