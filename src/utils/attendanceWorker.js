const { syncRecentPunches } = require("../services/attendanceService");

let syncInterval = null;
let isSyncing = false;

const DEFAULT_INTERVAL_MS =
  (Number(process.env.ATTENDANCE_SYNC_INTERVAL_SEC) || 30) * 1000;

/**
 * Run a single sync cycle
 */
async function runSyncCycle() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const res = await syncRecentPunches(50);
    if (res.newPunches > 0) {
      console.log(
        `[ATTENDANCE_WORKER] Successfully synced ${res.newPunches} new biometric punch(es).`
      );
    }
  } catch (err) {
    console.warn(`[ATTENDANCE_WORKER_WARN] Sync failed: ${err.message}`);
  } finally {
    isSyncing = false;
  }
}

/**
 * Start background attendance synchronization worker
 */
function startAttendanceSyncWorker() {
  if (syncInterval) {
    console.log("[ATTENDANCE_WORKER] Worker already active.");
    return;
  }

  console.log(
    `[ATTENDANCE_WORKER] Starting biometric sync worker (Interval: ${DEFAULT_INTERVAL_MS / 1000}s)...`
  );

  // Run initial sync after a short delay
  setTimeout(() => {
    runSyncCycle().catch(() => {});
  }, 5000);

  syncInterval = setInterval(() => {
    runSyncCycle().catch(() => {});
  }, DEFAULT_INTERVAL_MS);
}

/**
 * Stop background attendance synchronization worker
 */
function stopAttendanceSyncWorker() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[ATTENDANCE_WORKER] Worker stopped.");
  }
}

module.exports = {
  startAttendanceSyncWorker,
  stopAttendanceSyncWorker,
  runSyncCycle,
};
