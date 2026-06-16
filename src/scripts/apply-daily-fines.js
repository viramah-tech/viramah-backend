require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { applyDailyFines } = require("../services/fineService");

const run = async () => {
  try {
    console.log("[CLI] Connecting to DB...");
    await connectDB();
    await applyDailyFines();
    console.log("[CLI] Daily fine run completed successfully.");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("[CLI] Failed to run daily fines script:", err);
    process.exit(1);
  }
};

run();
