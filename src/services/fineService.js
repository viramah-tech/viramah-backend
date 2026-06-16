const User = require("../models/User");
const crypto = require("crypto");
const { recalculateGrandTotal } = require("../utils/waterfall");

const applyDailyFines = async () => {
  try {
    console.log("[FINE SERVICE] Starting daily fine application (₹100/day)...");
    
    // Find all users/tenants whose role is user or tenant
    const users = await User.find({
      role: { $in: ["user", "tenant"] }
    });
    
    let count = 0;
    for (const user of users) {
      const summary = user.paymentSummary || {};
      
      // Calculate pending amount EXCLUDING fines
      const pendingRegular = 
        (summary.registrationFee?.remaining || 0) +
        (summary.securityDeposit?.remaining || 0) +
        (summary.roomRent?.remaining || 0) +
        (summary.messFee?.remaining || 0) +
        (summary.transportFee?.remaining || 0);

      if (pendingRegular <= 0) {
        continue; // Skip if no regular dues pending
      }

      const fineId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");

      if (!user.finesList) user.finesList = [];
      user.finesList.push({
        fineId,
        amount: 100,
        reason: `Daily Fine (Auto-applied for outstanding regular balance of ₹${pendingRegular})`,
        date: new Date(),
        addedBy: "system",
        type: "daily",
        isRemoved: false,
      });

      if (!user.paymentSummary) {
        user.paymentSummary = {};
      }
      if (!user.paymentSummary.fines) {
        user.paymentSummary.fines = { total: 0, paid: 0, remaining: 0 };
      }

      user.paymentSummary.fines.total = (user.paymentSummary.fines.total || 0) + 100;
      user.paymentSummary.fines.remaining = (user.paymentSummary.fines.remaining || 0) + 100;

      recalculateGrandTotal(user.paymentSummary);
      await user.save();
      count++;
    }

    console.log(`[FINE SERVICE] Daily fines of ₹100 applied to ${count} users with outstanding regular balances.`);
    return count;
  } catch (err) {
    console.error("[FINE SERVICE] Error applying daily fines:", err);
    throw err;
  }
};

module.exports = { applyDailyFines };
