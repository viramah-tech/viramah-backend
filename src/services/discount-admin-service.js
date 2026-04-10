'use strict';

/**
 * discountAdminService.js — V2.0 Hierarchical Discount Management.
 *
 * Discount resolution priority:
 *   1. Booking-specific override (highest)
 *   2. User special discount
 *   3. Global default (lowest)
 *
 * Admins can set per-user and per-booking overrides with validation
 * against configurable max caps.
 *
 * ALL monetary values in RUPEES (INR).
 */

const Booking = require('../models/Booking');
const User = require('../models/User');
const { getPricingConfig } = require('./pricingService');

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

/**
 * Set discount overrides for a specific user.
 * These override global defaults and are applied to future bookings.
 */
async function setUserDiscount(userId, discountData, adminId) {
  const { fullTenurePercent, halfYearlyPercent, validUntil, reason } = discountData;

  // Validate against maximums
  const cfg = await getPricingConfig();
  const maxFull = cfg.discounts?.fullTenure?.maxPercent || 50;
  const maxHalf = cfg.discounts?.halfYearly?.maxPercent || 35;

  if (fullTenurePercent != null && fullTenurePercent > maxFull) {
    throw err(`Full tenure discount cannot exceed ${maxFull}%`, 400);
  }
  if (halfYearlyPercent != null && halfYearlyPercent > maxHalf) {
    throw err(`Half yearly discount cannot exceed ${maxHalf}%`, 400);
  }

  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);

  // Initialize if needed
  if (!user.paymentProfile) user.paymentProfile = {};
  if (!user.paymentProfile.discountEligibility) {
    user.paymentProfile.discountEligibility = {};
  }
  if (!user.paymentProfile.discountEligibility.specialDiscounts) {
    user.paymentProfile.discountEligibility.specialDiscounts = [];
  }

  // Add special discount entry
  const expiryDate = validUntil
    ? new Date(validUntil)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default: 30 days

  user.paymentProfile.discountEligibility.specialDiscounts.push({
    type: 'ADMIN_OVERRIDE',
    discountPercent: fullTenurePercent || halfYearlyPercent,
    validFrom: new Date(),
    validUntil: expiryDate,
    setBy: adminId,
  });

  // Update max eligibility if higher
  if (fullTenurePercent != null) {
    user.paymentProfile.discountEligibility.maxFullTenureDiscount = Math.max(
      user.paymentProfile.discountEligibility.maxFullTenureDiscount || 40,
      fullTenurePercent
    );
  }
  if (halfYearlyPercent != null) {
    user.paymentProfile.discountEligibility.maxHalfYearlyDiscount = Math.max(
      user.paymentProfile.discountEligibility.maxHalfYearlyDiscount || 25,
      halfYearlyPercent
    );
  }

  await user.save();

  // If user has active booking, update booking-level override too
  if (user.paymentProfile.currentBookingId) {
    await setBookingDiscount(user.paymentProfile.currentBookingId, {
      fullTenurePercent,
      halfYearlyPercent,
      validUntil: expiryDate,
    }, adminId);
  }

  return {
    userId,
    fullTenurePercent,
    halfYearlyPercent,
    validUntil: expiryDate,
    reason,
    setBy: adminId,
  };
}

/**
 * Set discount override directly on a booking.
 */
async function setBookingDiscount(bookingId, discountData, adminId) {
  const { fullTenurePercent, halfYearlyPercent, messDiscountPercent, transportDiscountPercent, validUntil } = discountData;

  // Validate against maximums
  const cfg = await getPricingConfig();
  const maxFull = cfg.discounts?.fullTenure?.maxPercent || 50;
  const maxHalf = cfg.discounts?.halfYearly?.maxPercent || 35;

  if (fullTenurePercent != null && fullTenurePercent > maxFull) {
    throw err(`Full tenure discount cannot exceed ${maxFull}%`, 400);
  }
  if (halfYearlyPercent != null && halfYearlyPercent > maxHalf) {
    throw err(`Half yearly discount cannot exceed ${maxHalf}%`, 400);
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  // Apply overrides
  if (fullTenurePercent != null)      booking.discountOverrides.fullTenurePercent = fullTenurePercent;
  if (halfYearlyPercent != null)      booking.discountOverrides.halfYearlyPercent = halfYearlyPercent;
  if (messDiscountPercent != null)    booking.discountOverrides.messDiscountPercent = messDiscountPercent;
  if (transportDiscountPercent != null) booking.discountOverrides.transportDiscountPercent = transportDiscountPercent;
  if (validUntil)                     booking.discountOverrides.validUntil = new Date(validUntil);

  booking.discountOverrides.setBy = adminId;
  booking.discountOverrides.setAt = new Date();

  // Recalculate projected bill with new discounts
  if (booking.displayBills?.projectedFinalBill) {
    const { calculateProjectedFinalBill } = require('./bookingService');
    const updatedBill = await calculateProjectedFinalBill(
      booking.selections.roomType,
      booking.selections.tenure || 11,
      booking.selections.mess?.selected || false,
      booking.selections.transport?.selected || false,
      cfg,
      booking.userId
    );
    booking.displayBills.projectedFinalBill = updatedBill;
  }

  booking.statusHistory.push({
    status: booking.status,
    changedBy: adminId,
    reason: `Discount override: Full=${fullTenurePercent || 'unchanged'}%, Half=${halfYearlyPercent || 'unchanged'}%`,
  });

  await booking.save();

  return {
    bookingId: booking.bookingId,
    discountOverrides: booking.discountOverrides,
    updatedProjectedBill: booking.displayBills?.projectedFinalBill || null,
  };
}

/**
 * Get the effective discount for a booking (resolves hierarchy).
 *
 * Priority: Booking override → User special → Global default
 */
async function getEffectiveDiscount(bookingId, trackType) {
  const track = trackType === 'FULL_TENURE' ? 'fullTenure' : 'halfYearly';
  const percentKey = `${track}Percent`;

  const booking = await Booking.findById(bookingId);
  if (!booking) throw err('Booking not found', 404);

  // Priority 1: Booking-specific override
  if (booking.discountOverrides?.[percentKey] != null) {
    const override = booking.discountOverrides;
    // Check if still valid
    if (!override.validUntil || new Date(override.validUntil) > new Date()) {
      return {
        percent: override[percentKey],
        source: 'BOOKING_OVERRIDE',
        setBy: override.setBy,
        validUntil: override.validUntil,
      };
    }
  }

  // Priority 2: User special discounts
  const user = await User.findById(booking.userId);
  if (user?.paymentProfile?.discountEligibility?.specialDiscounts) {
    const activeDiscount = user.paymentProfile.discountEligibility.specialDiscounts.find(
      d => d.validUntil && new Date(d.validUntil) > new Date() && !d.appliedToBookingId
    );
    if (activeDiscount) {
      return {
        percent: activeDiscount.discountPercent,
        source: 'USER_SPECIAL',
        type: activeDiscount.type,
        validUntil: activeDiscount.validUntil,
      };
    }
  }

  // Priority 3: Global default
  const cfg = await getPricingConfig();
  return {
    percent: cfg.discounts?.[track]?.defaultPercent || (track === 'fullTenure' ? 40 : 25),
    source: 'GLOBAL_DEFAULT',
  };
}

/**
 * Get discount audit trail for a user (admin view).
 */
async function getDiscountAudit(userId) {
  const user = await User.findById(userId);
  if (!user) throw err('User not found', 404);

  const cfg = await getPricingConfig();

  return {
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
    },
    currentDiscounts: {
      global: {
        fullTenure: cfg.discounts?.fullTenure?.defaultPercent || 40,
        halfYearly: cfg.discounts?.halfYearly?.defaultPercent || 25,
      },
      userOverrides: user.paymentProfile?.discountEligibility?.specialDiscounts
        ?.filter(d => d.validUntil && new Date(d.validUntil) > new Date()) || [],
      maxEligibility: {
        fullTenure: user.paymentProfile?.discountEligibility?.maxFullTenureDiscount || 40,
        halfYearly: user.paymentProfile?.discountEligibility?.maxHalfYearlyDiscount || 25,
      },
    },
    limits: {
      maxFullTenure: cfg.discounts?.fullTenure?.maxPercent || 50,
      maxHalfYearly: cfg.discounts?.halfYearly?.maxPercent || 35,
    },
  };
}

module.exports = {
  setUserDiscount,
  setBookingDiscount,
  getEffectiveDiscount,
  getDiscountAudit,
};
