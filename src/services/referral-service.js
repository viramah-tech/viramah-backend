'use strict';

/**
 * referralService.js — V2.0 Referral System.
 *
 * ₹1,000 referral credit:
 *  - Friend applies referrer code → ₹1,000 deducted from friend's final bill
 *  - Referrer earns ₹1,000 credit (can use on their own booking)
 *
 * ALL monetary values in RUPEES (INR).
 */

const Booking = require('../models/Booking');
const User = require('../models/User');
const { getPricingConfig } = require('./pricing-service');

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * Apply a referral code to a booking.
 * Gives the friend (current user) ₹1,000 credit on their final bill.
 * Credits the referrer ₹1,000 to use later.
 */
async function applyReferral(bookingId, referrerCode) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  // Can't apply referral if one is already set
  if (booking.referral?.referrerCode) {
    throw err('Referral code already applied to this booking', 400);
  }

  // Find the referrer by their code
  const referrer = await User.findOne({
    'paymentProfile.referralCode': referrerCode,
  });
  if (!referrer) throw err('Invalid referral code', 404);

  // Can't refer yourself
  if (referrer._id.toString() === booking.userId.toString()) {
    throw err('Cannot use your own referral code', 400);
  }

  const cfg = await getPricingConfig();
  const creditAmount = cfg.referralBonus || 1000;

  // 1. Apply credit to friend's booking
  booking.referral = {
    referrerCode,
    referrerUserId: referrer._id,
    creditApplied: creditAmount,
    friendCreditApplied: true,
  };

  // 2. Update projected bill with referral deduction
  if (booking.displayBills?.projectedFinalBill) {
    const creditEntry = {
      amount: creditAmount,
      referralId: referrerCode,
      label: `Referral Credit (${referrerCode})`,
    };

    // Add to both track options
    if (booking.displayBills.projectedFinalBill.fullTenure) {
      booking.displayBills.projectedFinalBill.fullTenure.deductions.referralCredits.push(creditEntry);
      booking.displayBills.projectedFinalBill.fullTenure.totalAfterDeductions -= creditAmount;
    }
    if (booking.displayBills.projectedFinalBill.halfYearly) {
      booking.displayBills.projectedFinalBill.halfYearly.deductions.referralCredits.push(creditEntry);
      booking.displayBills.projectedFinalBill.halfYearly.totalAfterDeductions -= creditAmount;
    }
  }

  booking.statusHistory.push({
    status: booking.status,
    changedBy: 'USER',
    reason: `Referral code ${referrerCode} applied — ₹${creditAmount} credit`,
  });

  await booking.save();

  // 3. Credit the referrer
  await User.findByIdAndUpdate(referrer._id, {
    $inc: { 'paymentProfile.referralCreditsEarned': creditAmount },
  });

  return {
    creditApplied: creditAmount,
    referrerName: referrer.name || 'User',
    referrerCode,
    message: `₹${creditAmount} referral credit applied to your booking`,
  };
}

/**
 * Use earned referral credits on a booking.
 * Applied as a deduction to the final bill.
 */
async function useReferralCredit(userId, bookingId) {
  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);

  const earned = user.paymentProfile?.referralCreditsEarned || 0;
  const used = user.paymentProfile?.referralCreditsUsed || 0;
  const available = earned - used;

  if (available <= 0) {
    return { creditUsed: 0, message: 'No referral credits available' };
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  // Don't apply more credit than the bill total
  const billTotal = booking.displayBills?.projectedFinalBill?.fullTenure?.grandTotal || 0;
  const amountToUse = Math.min(available, billTotal);

  if (amountToUse <= 0) {
    return { creditUsed: 0, message: 'No applicable amount to credit' };
  }

  // Apply to booking as deduction
  if (booking.displayBills?.projectedFinalBill) {
    const creditEntry = {
      amount: amountToUse,
      referralId: 'SELF_CREDIT',
      label: `Referral Credit Used (₹${amountToUse})`,
    };

    if (booking.displayBills.projectedFinalBill.fullTenure) {
      booking.displayBills.projectedFinalBill.fullTenure.deductions.referralCredits.push(creditEntry);
      booking.displayBills.projectedFinalBill.fullTenure.totalAfterDeductions -= amountToUse;
    }
    if (booking.displayBills.projectedFinalBill.halfYearly) {
      booking.displayBills.projectedFinalBill.halfYearly.deductions.referralCredits.push(creditEntry);
      booking.displayBills.projectedFinalBill.halfYearly.totalAfterDeductions -= amountToUse;
    }
  }

  await booking.save();

  // Mark credits as used
  user.paymentProfile.referralCreditsUsed = used + amountToUse;
  await user.save();

  return {
    creditUsed: amountToUse,
    remainingCredits: available - amountToUse,
    message: `₹${amountToUse} referral credit applied`,
  };
}

/**
 * Generate a unique referral code for a user.
 */
async function generateReferralCode(userId) {
  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);

  if (user.paymentProfile?.referralCode) {
    return { code: user.paymentProfile.referralCode, isNew: false };
  }

  // Generate code: VIR-XXXX (4 alphanumeric chars)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let attempts = 0;

  do {
    code = 'VIR-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    // Check uniqueness
    const exists = await User.findOne({ 'paymentProfile.referralCode': code });
    if (!exists) break;
    attempts++;
  } while (attempts < 10);

  if (attempts >= 10) {
    // Fallback: use userId suffix
    code = `VIR-${userId.toString().slice(-6).toUpperCase()}`;
  }

  user.paymentProfile = user.paymentProfile || {};
  user.paymentProfile.referralCode = code;
  await user.save();

  return { code, isNew: true };
}

/**
 * Get referral stats for a user.
 */
async function getReferralStats(userId) {
  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);

  const earned = user.paymentProfile?.referralCreditsEarned || 0;
  const used = user.paymentProfile?.referralCreditsUsed || 0;

  // Count how many friends used this user's code
  const referralCount = await Booking.countDocuments({
    'referral.referrerUserId': userId,
    'referral.friendCreditApplied': true,
  });

  return {
    referralCode: user.paymentProfile?.referralCode || null,
    totalEarned: earned,
    totalUsed: used,
    available: earned - used,
    friendsReferred: referralCount,
  };
}

module.exports = {
  applyReferral,
  useReferralCredit,
  generateReferralCode,
  getReferralStats,
};
