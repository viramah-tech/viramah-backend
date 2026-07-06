const { ValidationError } = require("./errors");

/**
 * Allocate a booking payment across categories using waterfall logic.
 * Order: registration fee -> security deposit -> room rent
 *
 * @param {number} amount - Total payment amount
 * @param {object} summary - User's paymentSummary object
 * @returns {object} breakdown - How much allocated to each category
 * @throws {ValidationError} if amount exceeds total outstanding balance
 */
const allocateWaterfall = (amount, summary) => {
  if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
    throw new ValidationError("Payment amount must be greater than 0");
  }

  if (!summary || !summary.grandTotal) {
    throw new ValidationError("Payment summary is not initialized");
  }

  if (amount > summary.grandTotal.remaining) {
    throw new ValidationError("Amount exceeds total outstanding balance");
  }

  let remaining = amount;
  const breakdown = {
    registrationFee: 0,
    securityDeposit: 0,
    roomRent: 0,
    messFee: 0,
    transportFee: 0,
  };

  // Step 1: Registration Fee
  if (remaining > 0 && summary.registrationFee?.remaining > 0) {
    const alloc = Math.min(remaining, summary.registrationFee.remaining);
    breakdown.registrationFee = alloc;
    remaining -= alloc;
  }

  // Step 2: Security Deposit
  if (remaining > 0 && summary.securityDeposit?.remaining > 0) {
    const alloc = Math.min(remaining, summary.securityDeposit.remaining);
    breakdown.securityDeposit = alloc;
    remaining -= alloc;
  }

  // Step 3: Room Rent
  if (remaining > 0 && summary.roomRent?.remaining > 0) {
    const alloc = Math.min(remaining, summary.roomRent.remaining);
    breakdown.roomRent = alloc;
    remaining -= alloc;
  }

  // Step 4: Mess Fee
  if (remaining > 0 && summary.messFee?.remaining > 0) {
    const alloc = Math.min(remaining, summary.messFee.remaining);
    breakdown.messFee = alloc;
    remaining -= alloc;
  }

  // Step 5: Transport Fee
  if (remaining > 0 && summary.transportFee?.remaining > 0) {
    const alloc = Math.min(remaining, summary.transportFee.remaining);
    breakdown.transportFee = alloc;
    remaining -= alloc;
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

const MAP_PAYMENT_CATEGORY_TO_SUMMARY_KEY = {
  room_rent: "roomRent",
  mess: "messFee",
  transport: "transportFee",
  security_deposit: "securityDeposit",
  registration_fee: "registrationFee",
  fine: "fines",
};

const reapplyApprovedPayments = (user) => {
  const summary = user.paymentSummary;
  if (!summary) return;

  const categories = ["registrationFee", "securityDeposit", "roomRent", "messFee", "transportFee", "fines"];

  // 1. Reset all paid and remaining values to total (starting from scratch)
  for (const cat of categories) {
    if (summary[cat]) {
      summary[cat].paid = 0;
      summary[cat].remaining = summary[cat].total || 0;
    }
  }

  // 2. Loop through all approved payments and apply them
  const approvedPayments = (user.paymentDetails || []).filter((p) => p.status === "approved");

  for (const p of approvedPayments) {
    const amount = p.amounts?.totalAmount || 0;
    if (amount <= 0) continue;

    if (p.paymentType === "booking" || p.category === "all") {
      // Use waterfall allocation
      let breakdown;
      if (p.breakdown && Object.keys(p.breakdown).length > 0) {
        breakdown = p.breakdown;
      } else {
        try {
          breakdown = allocateWaterfall(amount, summary);
          p.breakdown = breakdown;
        } catch (e) {
          // If waterfall fails, fallback to simple distribution
          breakdown = { registrationFee: 0, securityDeposit: 0, roomRent: 0, messFee: 0, transportFee: 0 };
        }
      }

      // Apply the breakdown
      for (const cat of categories) {
        const alloc = breakdown[cat] || 0;
        if (alloc > 0 && summary[cat]) {
          summary[cat].paid = (summary[cat].paid || 0) + alloc;
          summary[cat].remaining = Math.max(0, (summary[cat].total || 0) - summary[cat].paid);
        }
      }
    } else {
      // Final/standard payment to specific category
      const summaryKey = MAP_PAYMENT_CATEGORY_TO_SUMMARY_KEY[p.category];
      if (summaryKey && summary[summaryKey]) {
        summary[summaryKey].paid = (summary[summaryKey].paid || 0) + amount;
        summary[summaryKey].remaining = Math.max(0, (summary[summaryKey].total || 0) - summary[summaryKey].paid);
      }
    }
  }

  // 3. Recalculate grand total
  recalculateGrandTotal(summary);
};

module.exports = { allocateWaterfall, recalculateGrandTotal, reapplyApprovedPayments };
