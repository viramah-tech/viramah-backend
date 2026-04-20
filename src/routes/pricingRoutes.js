const express = require("express");
const PricingConfig = require("../models/PricingConfig");

const DEFAULT_PRICING = {
  tenureMonths: 11,
  registrationFee: 1000,
  securityDeposit: 15000,
  mess: { monthlyFee: 2000, annualDiscountedPrice: 19900 },
  transport: { monthlyFee: 2000 },
  bookingPayment: { minimumAmount: 1000, suggestedAmount: 16000 },
  paymentDeadlineDays: 30,
};

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    let pricing = await PricingConfig.findOne();
    // Self-heal missing config so onboarding never breaks on a fresh DB.
    if (!pricing) {
      pricing = await PricingConfig.create(DEFAULT_PRICING);
    }
    res.json({ success: true, data: { pricing } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
