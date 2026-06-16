require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const adminService = require("../services/adminService");
const { applyDailyFines } = require("../services/fineService");

const runTest = async () => {
  try {
    console.log("Connecting to Database...");
    await connectDB();
    console.log("Connected!");

    // 1. Create a temporary test user
    console.log("Seeding a temporary test user...");
    const dummyId = "TEST_" + Math.floor(Math.random() * 10000);
    let user = new User({
      basicInfo: {
        userId: dummyId,
        fullName: "Test Fine User",
        email: `${dummyId}@example.com`,
        phone: "9999999999"
      },
      auth: {
        passwordHash: "dummyhash"
      },
      role: "user",
      paymentSummary: {
        registrationFee: { total: 1000, paid: 0, remaining: 1000 },
        securityDeposit: { total: 5000, paid: 0, remaining: 5000 },
        roomRent: { total: 9000, paid: 0, remaining: 9000 },
        grandTotal: { total: 15000, paid: 0, remaining: 15000 },
        isFullyPaid: false
      }
    });
    await user.save();
    console.log("Temporary test user created:", user.basicInfo.userId);

    const testUserId = user.basicInfo.userId;

    // 2. Add manual fine
    console.log("\n--- Testing addFine ---");
    user = await adminService.addFine(testUserId, 150, "Late payment dues", "test_admin");
    console.log("Fine added! New Fines ledger:", user.paymentSummary.fines);
    console.log("New Grand Total total:", user.paymentSummary.grandTotal.total);
    console.log("New Grand Total remaining:", user.paymentSummary.grandTotal.remaining);

    // Verify fine is in finesList
    const manualFine = user.finesList.find(f => f.amount === 150 && !f.isRemoved);
    if (!manualFine) {
      throw new Error("Manual fine not found in finesList!");
    }
    console.log("Found manual fine in finesList:", manualFine);

    // 3. Test applyDailyFines (₹100 daily fine)
    console.log("\n--- Testing applyDailyFines ---");
    const preCount = user.finesList.filter(f => f.type === "daily").length;
    await applyDailyFines();
    
    // Fetch user again
    user = await User.findOne({ "basicInfo.userId": testUserId });
    const postCount = user.finesList.filter(f => f.type === "daily").length;
    console.log(`Daily fines count check: pre=${preCount}, post=${postCount}`);
    if (postCount <= preCount) {
      throw new Error("Daily fine was not applied successfully!");
    }
    console.log("Daily fine applied! New Fines ledger:", user.paymentSummary.fines);
    console.log("New Grand Total remaining:", user.paymentSummary.grandTotal.remaining);

    // 4. Remove manual fine
    console.log("\n--- Testing removeFine ---");
    user = await adminService.removeFine(testUserId, manualFine.fineId, "Waived off by authority", "test_admin");
    console.log("Fine removed! New Fines ledger:", user.paymentSummary.fines);
    console.log("New Grand Total remaining:", user.paymentSummary.grandTotal.remaining);
    
    // Verify fine is marked as removed
    const checkedFine = user.finesList.find(f => f.fineId === manualFine.fineId);
    if (!checkedFine.isRemoved) {
      throw new Error("Fine was not marked as removed!");
    }
    console.log("Fine removal details verified in DB!");

    // Clean up if it was a temporary user
    if (testUserId.startsWith("TEST_")) {
      console.log("\nCleaning up temporary test user...");
      await User.deleteOne({ "basicInfo.userId": testUserId });
      console.log("Cleaned up!");
    }

    console.log("\nAll tests passed successfully!");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("\nTest Failed:", err);
    await mongoose.disconnect();
    process.exit(1);
  }
};

runTest();
