const { ValidationError } = require("./errors");

const MAP_PAYMENT_CATEGORY_TO_SUMMARY_KEY = {
  room_rent: "roomRent",
  roomRent: "roomRent",
  mess: "messFee",
  messFee: "messFee",
  transport: "transportFee",
  transportFee: "transportFee",
  security_deposit: "securityDeposit",
  securityDeposit: "securityDeposit",
  registration_fee: "registrationFee",
  registrationFee: "registrationFee",
  fine: "fines",
  fines: "fines",
};

/**
 * Flexible Payment Allocation with Dynamic Spillover.
 */
const allocateWaterfall = (amount, summary, targetCategory = null) => {
  if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
    throw new ValidationError("Payment amount must be greater than 0");
  }

  if (!summary) {
    throw new ValidationError("Payment summary is not initialized");
  }

  recalculateGrandTotal(summary);

  const grandRemaining = summary.grandTotal?.remaining ?? amount;
  const maxAllocatable = grandRemaining > 0 ? grandRemaining : amount;
  let remaining = Math.min(amount, maxAllocatable);

  const breakdown = {
    registrationFee: 0,
    securityDeposit: 0,
    roomRent: 0,
    messFee: 0,
    transportFee: 0,
    fines: 0,
  };

  const targetKey = targetCategory ? (MAP_PAYMENT_CATEGORY_TO_SUMMARY_KEY[targetCategory] || targetCategory) : null;

  if (targetKey && summary[targetKey] && summary[targetKey].remaining > 0 && remaining > 0) {
    const alloc = Math.min(remaining, summary[targetKey].remaining);
    breakdown[targetKey] = alloc;
    remaining -= alloc;
  }

  const priorityOrder = ["roomRent", "securityDeposit", "registrationFee", "messFee", "transportFee", "fines"];

  for (const cat of priorityOrder) {
    if (remaining <= 0) break;
    if (cat === targetKey) continue;

    if (summary[cat] && summary[cat].remaining > 0) {
      const alloc = Math.min(remaining, summary[cat].remaining);
      breakdown[cat] += alloc;
      remaining -= alloc;
    }
  }

  if (remaining > 0) {
    const fallbackKey = targetKey && breakdown[targetKey] !== undefined ? targetKey : "roomRent";
    breakdown[fallbackKey] += remaining;
  }

  return breakdown;
};

/**
 * Recalculate grandTotal total, paid, and remaining fields based on individual category ledgers.
 * GST is applied ONLY to the transportFee (18% GST).
 */
const recalculateGrandTotal = (summary) => {
  if (!summary) return;
  const categories = ["registrationFee", "securityDeposit", "roomRent", "messFee", "transportFee", "fines"];

  let basePriceSum = 0;
  let gstAmountSum = 0;
  let totalSum = 0;
  let paidSum = 0;
  let remainingSum = 0;

  for (const cat of categories) {
    if (summary[cat]) {
      const catTotal = summary[cat].total || 0;
      let catBase = catTotal;
      let catGst = 0;

      // GST is applied ONLY to transportFee
      if (cat === "transportFee" && catTotal > 0) {
        catBase = summary[cat].basePrice || Math.round(catTotal / 1.18);
        catGst = summary[cat].gstAmount || (catTotal - catBase);
        summary[cat].basePrice = catBase;
        summary[cat].gstAmount = catGst;
        summary[cat].gstRatePct = 18;
      } else if (summary[cat]) {
        summary[cat].basePrice = catTotal;
        summary[cat].gstAmount = 0;
        summary[cat].gstRatePct = 0;
      }

      basePriceSum += catBase;
      gstAmountSum += catGst;
      totalSum += catTotal;
      paidSum += summary[cat].paid || 0;
      remainingSum += summary[cat].remaining || 0;
    }
  }

  if (!summary.grandTotal) {
    summary.grandTotal = { basePrice: 0, gstAmount: 0, total: 0, paid: 0, remaining: 0 };
  }

  summary.grandTotal.basePrice = basePriceSum;
  summary.grandTotal.gstAmount = gstAmountSum;
  summary.grandTotal.total = totalSum;
  summary.grandTotal.paid = paidSum;
  summary.grandTotal.remaining = Math.max(0, remainingSum);
  summary.isFullyPaid = summary.grandTotal.remaining <= 0;
};

/**
 * Re-applies all approved payments cleanly with target category & dynamic spillover.
 */
const reapplyApprovedPayments = (user) => {
  const summary = user.paymentSummary;
  if (!summary) return;

  const categories = ["registrationFee", "securityDeposit", "roomRent", "messFee", "transportFee", "fines"];

  for (const cat of categories) {
    if (summary[cat]) {
      summary[cat].paid = 0;
      summary[cat].remaining = summary[cat].total || 0;
    }
  }

  recalculateGrandTotal(summary);

  const approvedPayments = (user.paymentDetails || []).filter((p) => p.status === "approved");

  for (const p of approvedPayments) {
    const amount = p.amounts?.totalAmount || 0;
    if (amount <= 0) continue;

    let breakdown;
    try {
      const targetCat = p.category || p.paymentType;
      breakdown = allocateWaterfall(amount, summary, targetCat);
      p.breakdown = breakdown;
    } catch (e) {
      breakdown = { registrationFee: 0, securityDeposit: 0, roomRent: 0, messFee: 0, transportFee: 0, fines: 0 };
    }

    for (const cat of categories) {
      const alloc = breakdown[cat] || 0;
      if (alloc > 0 && summary[cat]) {
        summary[cat].paid = (summary[cat].paid || 0) + alloc;
        summary[cat].remaining = Math.max(0, (summary[cat].total || 0) - summary[cat].paid);
      }
    }
    recalculateGrandTotal(summary);
  }

  recalculateGrandTotal(summary);
};

module.exports = { allocateWaterfall, recalculateGrandTotal, reapplyApprovedPayments, MAP_PAYMENT_CATEGORY_TO_SUMMARY_KEY };
