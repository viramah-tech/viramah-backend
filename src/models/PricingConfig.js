const mongoose = require('mongoose');

/**
 * PricingConfig.js — V2.0 Singleton document.
 *
 * Single source of truth for all server-side pricing constants.
 * ALL monetary values in RUPEES (INR).
 *
 * V2.0 additions:
 *  - roomPricing: per-room-type monthly base rates
 *  - discounts: structured with default + max caps
 *  - servicePricing: mess/transport rates
 *  - gst: centralized GST configuration
 */
const pricingConfigSchema = new mongoose.Schema(
  {
    // ── Legacy fields (preserved for backward compat) ────────────────────
    registrationFee:  { type: Number, default: 1000, min: 0 },
    securityDeposit:  { type: Number, default: 15000, min: 0 },
    gstRate:          { type: Number, default: 0.12, min: 0, max: 1 },  // 12% on room rent only
    transportMonthly: { type: Number, default: 2000, min: 0 },
    messMonthly:      { type: Number, default: 2200, min: 0 },
    messLumpSum:      { type: Number, default: 19900, min: 0 },
    discountFull:     { type: Number, default: 0.40, min: 0, max: 1 },
    discountHalf:     { type: Number, default: 0.25, min: 0, max: 1 },
    referralBonus:    { type: Number, default: 1000, min: 0 },
    tenureMonths:     { type: Number, default: 11, min: 1 },
    installment1Months: { type: Number, default: 6, min: 1 },
    bookingUpgradeDeadlineDays: { type: Number, default: 30, min: 1 },
    phase1DeadlineDays:         { type: Number, default: 15, min: 1 },
    currentTermsVersion:   { type: String, default: 'v1.0' },
    currentPrivacyVersion: { type: String, default: 'v1.0' },

    // ── V2.0: Booking Amount (Fixed) ─────────────────────────────────────
    bookingAmount: {
      securityDeposit:     { type: Number, default: 15000 },
      registrationFee:     { type: Number, default: 1000 },
      registrationGstRate: { type: Number, default: 0 },      // No GST on registration fee
      total:               { type: Number, default: 16000 },  // 15000 + 1000
    },

    // ── V2.0: Room Pricing (Monthly base rates per type) ─────────────────
    roomPricing: {
      AXIS_PLUS_STUDIO: { baseMonthly: { type: Number, default: 24538 } },
      AXIS_STUDIO:      { baseMonthly: { type: Number, default: 21563 } },
      COLLECTIVE_1BHK:  { baseMonthly: { type: Number, default: 18587 } },
      NEXUS_1BHK:       { baseMonthly: { type: Number, default: 13527 } },
    },

    // ── V2.0: Discount Structure (with max caps) ─────────────────────────
    discounts: {
      fullTenure: {
        defaultPercent: { type: Number, default: 40 },
        maxPercent:     { type: Number, default: 50 },
      },
      halfYearly: {
        defaultPercent: { type: Number, default: 25 },
        maxPercent:     { type: Number, default: 35 },
      },
    },

    // ── V2.0: Service Pricing ────────────────────────────────────────────
    servicePricing: {
      mess: {
        monthly:          { type: Number, default: 2000 },
        fullTenureLumpSum: { type: Number, default: 19900 },
      },
      transport: {
        monthly: { type: Number, default: 2000 },
      },
    },

    // ── V2.0: Timer Configuration ────────────────────────────────────────
    timers: {
      priceLockMinutes:      { type: Number, default: 15 },
      bookingPaymentMinutes: { type: Number, default: 4320 },  // 3 days to submit booking payment
      finalPaymentDays:      { type: Number, default: 7 },
      installmentGraceDays:  { type: Number, default: 3 },
      reminderSchedule:      { type: [Number], default: [3, 1, 0] },
      maxExtendDays:         { type: Number, default: 14 },
    },

    // ── V2.0: GST Configuration (Centralized) ───────────────────────────
    gst: {
      rate:         { type: Number, default: 0.12 },  // 12% on room rent only
      applicableOn: { type: [String], default: ['ROOM_RENT'] },
      exempt:       { type: [String], default: ['SECURITY_DEPOSIT', 'REGISTRATION_FEE', 'MESS', 'TRANSPORT'] },
      invoiceFormat: {
        mustInclude: { type: [String], default: ['GSTIN', 'HSN Code', 'Taxable Value', 'CGST/SGST or IGST'] },
        hsnCode: { type: String, default: '996311' }, // Accommodation in hotels/inn
        placeOfSupply: { type: String, default: 'PROPERTY_LOCATION' }
      }
    },

    // ── V2.0: Risk Scoring ───────────────────────────────────────────────
    riskScoring: {
      weights: {
        amountMismatch:  { type: Number, default: 20 },
        duplicateUtr:    { type: Number, default: 50 },
        imageQualityLow: { type: Number, default: 10 },
        timeExpiry:      { type: Number, default: 15 },
        newUser:         { type: Number, default: 5 },
      },
      thresholds: {
        low:    { type: Number, default: 25 },
        medium: { type: Number, default: 50 },
        high:   { type: Number, default: 51 },
      },
    },
  },
  {
    timestamps: true,
    collection: 'PricingConfig',
  }
);

const PricingConfig = mongoose.model('PricingConfig', pricingConfigSchema);

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
