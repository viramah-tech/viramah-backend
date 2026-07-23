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
 * Allocates incoming payment to targeted category first (e.g. securityDeposit or roomRent),
 * and dynamically spills over any remaining amount to fill unpaid dues in roomRent or other categories!
 *
 * @param {number} amount - Total payment amount
 * @param {object} summary - User's paymentSummary object
 * @param {string} [targetCategory] - Optional target category (e.g. "security_deposit", "room_rent")
 * @returns {object} breakdown - Allocation across categories
 */
const allocateWaterfall = (amount, summary, targetCategory = null) => {
  if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
    throw new ValidationError("Payment amount must be greater than 0");
  }

  if (!summary) {
    throw new ValidationError("Payment summary is not initialized");
  }

  // Ensure grandTotal is calculated and non-undefined
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

  // Step 1: Allocate to specified targetCategory first if valid and has remaining dues
  if (targetKey && summary[targetKey] && summary[targetKey].remaining > 0 && remaining > 0) {
    const alloc = Math.min(remaining, summary[targetKey].remaining);
    breakdown[targetKey] = alloc;
    remaining -= alloc;
  }

  // Step 2: Dynamic Spillover into other unpaid categories (roomRent, securityDeposit, etc.)
  const priorityOrder = ["roomRent", "securityDeposit", "registrationFee", "messFee", "transportFee", "fines"];

  for (const cat of priorityOrder) {
    if (remaining <= 0) break;
    if (cat === targetKey) continue; // Already processed in Step 1

    if (summary[cat] && summary[cat].remaining > 0) {
      const alloc = Math.min(remaining, summary[cat].remaining);
      breakdown[cat] += alloc;
      remaining -= alloc;
    }
  }

  // If there's still leftover amount after all categories are 0 remaining (overpayment cushion)
  if (remaining > 0) {
    const fallbackKey = targetKey && breakdown[targetKey] !== undefined ? targetKey : "roomRent";
    breakdown[fallbackKey] += remaining;
  }

  return breakdown;
};

/**
 * Recalculate grandTotal total, paid, and remaining fields based on individual category ledgers.
 * Ensure isFullyPaid is synchronized.
 *
 * @param {object} summary - User's paymentSummary object
 */
const recalculateGrandTotal = (summary) => {
  if (!summary) return;
  const categories = ["registrationFee", "securityDeposit", "roomRent", "messFee", "transportFee", "fines"];

  let totalSum = 0;
  let paidSum = 0;
  let remainingSum = 0;

  for (const cat of categories) {
    if (summary[cat]) {
      totalSum += summary[cat].total || 0;
      paidSum += summary[cat].paid || 0;
      remainingSum += summary[cat].remaining || 0;
    }
  }

  if (!summary.grandTotal) {
    summary.grandTotal = { total: 0, paid: 0, remaining: 0 };
  }

  summary.grandTotal.total = totalSum;
  summary.grandTotal.paid = paidSum;
  summary.grandTotal.remaining = Math.max(0, remainingSum); // Ensure non-negative remaining
  summary.isFullyPaid = summary.grandTotal.remaining <= 0;
};

/**
 * Re-applies all approved payments cleanly with target category & dynamic spillover.
 */
const reapplyApprovedPayments = (user) => {
  const summary = user.paymentSummary;
  if (!summary) return;

  const categories = ["registrationFee", "securityDeposit", "roomRent", "messFee", "transportFee", "fines"];

  // 1. Reset all paid and remaining values to total
  for (const cat of categories) {
    if (summary[cat]) {
      summary[cat].paid = 0;
      summary[cat].remaining = summary[cat].total || 0;
    }
  }

  recalculateGrandTotal(summary);

  // 2. Loop through all approved payments and apply them
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

    // Apply the breakdown
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
