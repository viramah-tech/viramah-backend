'use strict';

const { PricingConfig } = require('../../models/PricingConfig');
const { success, error } = require('../../utils/apiResponse');

const wrap = (fn) => async (req, res, next) => {
  try { return await fn(req, res); }
  catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const ALLOWED_FIELDS = [
  'registrationFee', 'securityDeposit', 'gstRate', 'transportMonthly',
  'messMonthly', 'messLumpSum', 'discountFull', 'discountHalf',
  'referralBonus', 'tenureMonths', 'installment1Months',
];

module.exports = {
  get: wrap(async (_req, res) => {
    const cfg = await PricingConfig.findOne();
    if (!cfg) return error(res, 'Pricing config not found', 404);
    return success(res, cfg, 'Pricing config');
  }),

  update: wrap(async (req, res) => {
    const cfg = await PricingConfig.findOne();
    if (!cfg) return error(res, 'Pricing config not found', 404);
    const previous = {};
    for (const k of ALLOWED_FIELDS) {
      if (req.body[k] !== undefined) {
        previous[k] = cfg[k];
        cfg[k] = req.body[k];
      }
    }
    await cfg.save();
    return success(res, { config: cfg, previous, changedBy: req.user?.name || '' }, 'Pricing updated');
  }),

  preview: wrap(async (req, res) => {
    const cfg = await PricingConfig.findOne();
    if (!cfg) return error(res, 'Pricing config not found', 404);
    const merged = { ...cfg.toObject(), ...req.body };
    // Compute a sample full-mode payment based on room rent passed in body
    const rent = Number(req.body.sampleRoomRent || 8000);
    const months = merged.tenureMonths || 11;
    const grossRent = rent * months;
    const discountFull = grossRent * (1 - merged.discountFull);
    const discountHalf1 = (rent * merged.installment1Months) * (1 - merged.discountHalf);
    return success(res, {
      proposed: merged,
      examples: {
        rentPerMonth: rent,
        fullMode: {
          rent: discountFull,
          security: merged.securityDeposit,
          registration: merged.registrationFee,
          total: discountFull + merged.securityDeposit + merged.registrationFee,
        },
        halfMode_inst1: {
          rent: discountHalf1,
          security: merged.securityDeposit,
          registration: merged.registrationFee,
          total: discountHalf1 + merged.securityDeposit + merged.registrationFee,
        },
      },
    }, 'Pricing preview');
  }),
};
