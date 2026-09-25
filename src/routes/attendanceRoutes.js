const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const attendanceService = require("../services/attendanceService");
const { logAdminAction } = require("../utils/auditLogger");

const router = express.Router();

// Strict Admin-Only Guard: ALL attendance operations are restricted to admin
router.use(auth);
router.use(roleGuard("admin"));

/**
 * GET /api/admin/attendance/daily
 * Get daily attendance timesheet & roster for all students
 */
router.get("/daily", async (req, res, next) => {
  try {
    const { date, search, status, room } = req.query;
    const result = await attendanceService.getDailyAttendanceSheet(date, {
      search,
      status,
      room,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/attendance/live
 * Real-time punch feed from the biometric terminal
 */
router.get("/live", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const punches = await attendanceService.getLivePunches(limit);
    res.json({ success: true, data: punches });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/attendance/unmapped-cards
 * List cards recorded by biometric terminal that are not linked to any student
 */
router.get("/unmapped-cards", async (req, res, next) => {
  try {
    const unmapped = await attendanceService.getUnmappedCards();
    res.json({ success: true, data: unmapped });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/attendance/map-card
 * Link an RFID / biometric card to an enrolled student
 */
router.post("/map-card", async (req, res, next) => {
  try {
    const { userId, cardNo } = req.body;
    const result = await attendanceService.mapCardToStudent(userId, cardNo);

    // Audit log
    try {
      await logAdminAction(
        req.user.basicInfo.userId,
        "MAP_BIOMETRIC_CARD",
        "attendance",
        {
          studentUserId: userId,
          cardNo,
          retroactivelyUpdatedPunches: result.retroactivelyUpdatedPunches,
        }
      );
    } catch (auditErr) {}

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/attendance/unmap-card
 * Unbind a card from a student
 */
router.post("/unmap-card", async (req, res, next) => {
  try {
    const { userId } = req.body;
    const result = await attendanceService.unmapCardFromStudent(userId);

    // Audit log
    try {
      await logAdminAction(
        req.user.basicInfo.userId,
        "UNMAP_BIOMETRIC_CARD",
        "attendance",
        { studentUserId: userId }
      );
    } catch (auditErr) {}

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/attendance/manual-punch
 * Record a manual attendance punch for a student
 */
router.post("/manual-punch", async (req, res, next) => {
  try {
    const adminName = req.user?.basicInfo?.fullName || "Admin";
    const newLog = await attendanceService.recordManualPunch(
      req.body,
      adminName
    );

    try {
      await logAdminAction(
        req.user.basicInfo.userId,
        "MANUAL_ATTENDANCE_PUNCH",
        "attendance",
        {
          studentUserId: req.body.userId,
          punchTime: newLog.punchTime,
          reason: req.body.reason,
        }
      );
    } catch (auditErr) {}

    res.json({
      success: true,
      message: "Manual attendance punch recorded successfully",
      data: newLog,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/attendance/sync
 * Manually trigger synchronization from biometric terminal
 */
router.post("/sync", async (req, res, next) => {
  try {
    const limit = Number(req.body.limit) || 100;
    const syncRes = await attendanceService.syncRecentPunches(limit);
    res.json({
      success: true,
      message: `Biometric sync completed: ${syncRes.newPunches} new punch(es) stored`,
      data: syncRes,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/attendance/student/:userId
 * Attendance history and punch ledger for an individual student
 */
router.get("/student/:userId", async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { from, to } = req.query;
    const history = await attendanceService.getStudentAttendanceHistory(
      userId,
      from,
      to
    );
    res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/attendance/device-status
 * Check RS 20 / RS 9 biometric machine connectivity and status
 */
router.get("/device-status", async (req, res, next) => {
  try {
    const hwStatus = await attendanceService.getHardwareStatus();
    res.json({ success: true, data: hwStatus });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/attendance/export
 * Export attendance roster as CSV
 */
router.get("/export", async (req, res, next) => {
  try {
    const { date, status, room } = req.query;
    const targetDate = date || attendanceService.getISTDateStr(new Date());
    const sheet = await attendanceService.getDailyAttendanceSheet(targetDate, {
      status,
      room,
    });

    const headers = [
      "Resident ID",
      "Full Name",
      "Room Number",
      "Biometric Card",
      "Date",
      "Status",
      "First In",
      "Last Out",
      "Hours Present",
      "Punches Logged",
    ];

    const rows = sheet.records.map((r) => [
      `"${r.userId}"`,
      `"${r.fullName.replace(/"/g, '""')}"`,
      `"${r.roomNumber}"`,
      `"${r.cardNo || "Unassigned"}"`,
      `"${sheet.date}"`,
      `"${r.status}"`,
      `"${r.firstIn || "--"}"`,
      `"${r.lastOut || "--"}"`,
      `"${r.hoursPresent}"`,
      r.punchCount,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join(
      "\r\n"
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Viramah_Attendance_${targetDate}.csv"`
    );
    res.send(csvContent);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
