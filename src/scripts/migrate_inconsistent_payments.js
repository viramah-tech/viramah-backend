require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const { reapplyApprovedPayments } = require("../utils/waterfall");

const run = async () => {
  try {
    console.log("[MIGRATION] Connecting to DB...");
    await connectDB();
    console.log("[MIGRATION] Connected successfully!");

    const users = await User.find({
      role: { $in: ["user", "tenant"] }
    });

    console.log(`[MIGRATION] Total user documents fetched: ${users.length}`);

    let updateCount = 0;
    for (const user of users) {
      const oldSummaryString = JSON.stringify(user.paymentSummary);
      
      // Run the corrected waterfall reapply function
      reapplyApprovedPayments(user);
      
      const newSummaryString = JSON.stringify(user.paymentSummary);

      if (oldSummaryString !== newSummaryString) {
        console.log(`[MIGRATION] Updating payment summary for: ${user.basicInfo?.fullName} (${user.basicInfo?.userId || user._id})`);
        console.log("  Before:", oldSummaryString);
        console.log("  After :", newSummaryString);
        
        // Mark paymentSummary and paymentDetails modified
        user.markModified("paymentSummary");
        user.markModified("paymentDetails");
        await user.save();
        updateCount++;
      }
    }

    console.log(`[MIGRATION] Completed. Updated ${updateCount} users.`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("[MIGRATION] Failed to run payments migration:", err);
    process.exit(1);
  }
};

run();
