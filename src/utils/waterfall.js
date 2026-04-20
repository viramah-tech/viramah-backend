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

  return breakdown;
};

module.exports = { allocateWaterfall };
