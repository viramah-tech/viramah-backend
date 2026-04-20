const mongoose = require("mongoose");

const pricingConfigSchema = new mongoose.Schema(
  {
    tenureMonths: { type: Number, default: 11 },
    registrationFee: { type: Number, default: 1000 },
    securityDeposit: { type: Number, default: 15000 },
    mess: {
      monthlyFee: { type: Number, default: 2000 },
      annualDiscountedPrice: { type: Number, default: 19900 },
    },
    transport: {
      monthlyFee: { type: Number, default: 2000 },
    },
    bookingPayment: {
      minimumAmount: { type: Number, default: 1000 },
      suggestedAmount: { type: Number, default: 16000 },
    },
    paymentDeadlineDays: { type: Number, default: 30 },
    defaultFullPaymentDiscountPct: { type: Number, default: 40 },
    defaultHalfPaymentDiscountPct: { type: Number, default: 25 },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.PricingConfig || mongoose.model("PricingConfig", pricingConfigSchema);
