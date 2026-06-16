const { applyDailyFines } = require("../services/fineService");
const User = require("../models/User");

const startFineScheduler = () => {
  console.log("[FINE SCHEDULER] Initializing daily fine scheduler...");
  
  // Run check every 1 hour (3600000ms)
  setInterval(async () => {
    try {
      const now = new Date();
      // Only run at 12:00 AM (midnight) to 1:00 AM
      if (now.getHours() === 0) {
        // Double check if we already applied daily fines today to avoid double-runs
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // Check if there is any user who has a daily fine added today
        const alreadyFined = await User.findOne({
          "finesList": {
            $elemMatch: {
              type: "daily",
              date: { $gte: startOfDay, $lte: endOfDay }
            }
          }
        });

        if (!alreadyFined) {
          console.log("[FINE SCHEDULER] Midnight reached. Applying daily fines...");
          await applyDailyFines();
        } else {
          console.log("[FINE SCHEDULER] Daily fines already applied for today. Skipping.");
        }
      }
    } catch (err) {
      console.error("[FINE SCHEDULER] Error in fine scheduler:", err);
    }
  }, 3600000); // 1 hour interval
};

module.exports = { startFineScheduler };
