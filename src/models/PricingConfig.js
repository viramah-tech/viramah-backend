const mongoose = require('mongoose');

/**
 * PricingConfig is a SINGLETON document storing all server-side pricing constants.
 * Update this document via the admin panel (future) or directly in the DB to change
 * pricing without redeploying code.
 *
 * IMPORTANT: This is the single source of truth for all fee amounts and rates.
 * No controller, service, or frontend should hardcode these values.
 */
const pricingConfigSchema = new mongoose.Schema(
  {
    /** Flat one-time admin/registration charge added to every payment (not discounted) */
    registrationFee: { type: Number, default: 1000, min: 0 },

    /** Refundable security deposit added to installment 1 only (not discounted) */
    securityDeposit: { type: Number, default: 15000, min: 0 },

    /**
     * GST rate applied ONLY to room rent (Indian standard: 12% on accommodation).
     * Applied after the discount, using two-step rounding (per Indian GST practice):
     *   1. discountedBase = Math.round(roomMonthly × (1 - discountRate))
     *   2. gstAmount     = Math.round(discountedBase × gstRate)
     *   3. monthlyTotal  = discountedBase + gstAmount
     */
    gstRate: { type: Number, default: 0.12, min: 0, max: 1 },

    /** Monthly transport/commute add-on (no GST). Discount applied per spec. */
    transportMonthly: { type: Number, default: 2000, min: 0 },

    /** Monthly mess/lunch add-on rate — used when NOT opting for lump sum (no GST) */
    messMonthly: { type: Number, default: 2200, min: 0 },

    /**
     * Full-tenure mess lump sum (available ONLY for 'full' payment mode).
     * Cheaper than paying monthly (₹2,200 × 11 = ₹24,200 vs ₹19,900 lump sum).
     */
    messLumpSum: { type: Number, default: 19900, min: 0 },

    /** Discount rate for 'full' payment mode (applied to room + add-ons) */
    discountFull: { type: Number, default: 0.40, min: 0, max: 1 },

    /** Discount rate for 'half' payment mode */
    discountHalf: { type: Number, default: 0.25, min: 0, max: 1 },

    /** Referral bonus — deducted from referree's final payable; credited to referrer */
    referralBonus: { type: Number, default: 1000, min: 0 },

    /** Total tenure in months */
    tenureMonths: { type: Number, default: 11, min: 1 },

    /** Number of months in installment 1 (half-pay mode) */
    installment1Months: { type: Number, default: 6, min: 1 },

    /**
     * Deadline (in days from booking creation) for a Track 3 booking plan to
     * upgrade to Full or Two-Part. After this window, upgradeTrack is rejected.
     */
    bookingUpgradeDeadlineDays: { type: Number, default: 30, min: 1 },

    /**
     * Deadline (in days from plan creation / first submission) for completing
     * Phase 1 payment. After this window, new submissions against Phase 1 are
     * rejected and the phase becomes overdue.
     */
    phase1DeadlineDays: { type: Number, default: 15, min: 1 },

    /** Current T&C and Privacy Policy versions (avoid hardcoding in controllers) */
    currentTermsVersion:   { type: String, default: 'v1.0' },
    currentPrivacyVersion: { type: String, default: 'v1.0' },
  },
  {
    timestamps: true,
    collection: 'PricingConfig',
  }
);

const PricingConfig = mongoose.model('PricingConfig', pricingConfigSchema);

/**
 * Seeds a default PricingConfig document if none exists.
 * Called during server startup from server.js or the config/db connection.
 */
const seedPricingConfig = async () => {
  try {
    const existing = await PricingConfig.findOne();
    if (!existing) {
      await PricingConfig.create({});
      console.log('[PricingConfig] Default pricing config seeded.');
    }
  } catch (err) {
    console.error('[PricingConfig] Failed to seed pricing config:', err.message);
  }
};

module.exports = { PricingConfig, seedPricingConfig };
