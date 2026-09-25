const mongoose = require("mongoose");
const AttendanceLog = require("../models/AttendanceLog");
const User = require("../models/User");
const { BadRequestError, NotFoundError } = require("../utils/errors");

// Helper: Safely query user by userId (RES...) or ObjectId
function buildStudentQuery(userId) {
  const isObjectId =
    mongoose.Types.ObjectId.isValid(userId) &&
    String(new mongoose.Types.ObjectId(userId)) === String(userId);
  return isObjectId
    ? { $or: [{ "basicInfo.userId": userId }, { _id: userId }] }
    : { "basicInfo.userId": userId };
}

// Default Biometric REST API endpoint on IIS port 80
const BIOMETRIC_API_URL =
  process.env.BIOMETRIC_API_URL || "http://localhost/api.ashx";

// Helper: Format a Date object to YYYY-MM-DD in Asia/Kolkata timezone
function getISTDateStr(date = new Date()) {
  try {
    const d = new Date(date);
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(d); // Returns YYYY-MM-DD
  } catch (err) {
    return new Date(date).toISOString().slice(0, 10);
  }
}

// Helper: Format a Date object to HH:mm:ss in Asia/Kolkata timezone
function getISTTimeStr(date = new Date()) {
  try {
    const d = new Date(date);
    return d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (err) {
    return new Date(date).toTimeString().slice(0, 8);
  }
}

/**
 * Low-level HTTP fetch from the IIS Biometric REST API (api.ashx)
 */
async function fetchBiometricApi(action, params = {}) {
  try {
    const url = new URL(BIOMETRIC_API_URL);
    url.searchParams.set("action", action);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(6000), // 6-second timeout
    });

    if (!response.ok) {
      throw new Error(`Biometric API returned HTTP ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.warn(`[BIOMETRIC_API_WARNING] Failed to fetch action=${action}:`, err.message);
    return { status: "error", message: err.message, data: [] };
  }
}

/**
 * Synchronize recent biometric punches from the hardware into MongoDB.
 * Matches punch card numbers to enrolled students.
 */
async function syncRecentPunches(limit = 100) {
  const result = {
    fetched: 0,
    synced: 0,
    newPunches: 0,
    errors: [],
  };

  try {
    const apiRes = await fetchBiometricApi("live", { limit });
    if (!apiRes || apiRes.status !== "success" || !Array.isArray(apiRes.data)) {
      return result;
    }

    result.fetched = apiRes.data.length;

    // Pre-load all students who have a biometricCardNo mapped
    const mappedStudents = await User.find(
      { "basicInfo.biometricCardNo": { $exists: true, $ne: null } },
      { "basicInfo.userId": 1, "basicInfo.fullName": 1, "basicInfo.biometricCardNo": 1, "roomDetails.roomNumber": 1 }
    ).lean();

    const studentMapByCard = new Map();
    for (const st of mappedStudents) {
      if (st.basicInfo?.biometricCardNo) {
        studentMapByCard.set(st.basicInfo.biometricCardNo.trim(), st);
      }
    }

    // Process punches
    for (const punch of apiRes.data) {
      try {
        const rawPunchId = Number(punch.id);
        const cardNo = String(punch.card_no || "").trim();
        if (!cardNo) continue;

        // Check if this punch is already persisted
        const existing = await AttendanceLog.findOne({ rawPunchId });
        if (existing) {
          result.synced++;
          continue;
        }

        // Parse punch time (assuming timestamp in SQL is local IST string, e.g. "2026-09-16 21:37:37")
        const punchDateTimeStr = punch.punch_time;
        let punchTime;
        if (punchDateTimeStr) {
          // Parse SQL format YYYY-MM-DD HH:mm:ss
          const isoLike = punchDateTimeStr.replace(" ", "T") + "+05:30";
          punchTime = new Date(isoLike);
          if (isNaN(punchTime.getTime())) {
            punchTime = new Date(punchDateTimeStr);
          }
        } else {
          punchTime = new Date();
        }

        const dateStr = getISTDateStr(punchTime);
        const matchedStudent = studentMapByCard.get(cardNo) || null;

        await AttendanceLog.create({
          rawPunchId,
          cardNo,
          student: matchedStudent ? matchedStudent._id : null,
          userId: matchedStudent ? matchedStudent.basicInfo?.userId : null,
          studentName: matchedStudent ? matchedStudent.basicInfo?.fullName : null,
          roomNumber: matchedStudent ? matchedStudent.roomDetails?.roomNumber : null,
          punchTime,
          dateStr,
          inOut: punch.in_out || "In/Ou",
          deviceSerial: punch.device_serial || "RSS202510129102",
          machineNo: String(punch.machine_no || "1"),
          source: "biometric",
          status: "PRESENT",
        });

        result.newPunches++;
        result.synced++;
      } catch (err) {
        // E11000 duplicate key error is expected in concurrent syncs
        if (err.code === 11000) {
          result.synced++;
        } else {
          result.errors.push(err.message);
        }
      }
    }

    return result;
  } catch (err) {
    console.error("[ATTENDANCE_SYNC_ERROR]", err);
    result.errors.push(err.message);
    return result;
  }
}

/**
 * Get the daily attendance sheet for a specific date (defaults to today).
 * Lists all active students with their First In, Last Out, total hours, and attendance status.
 */
async function getDailyAttendanceSheet(dateStr = null, queryParams = {}) {
  const targetDate = dateStr || getISTDateStr(new Date());
  const { search = "", status = "ALL", room = "" } = queryParams;

  // 1. Fetch all enrolled students
  const studentQuery = {
    "basicInfo.userId": { $exists: true, $ne: null },
    accountStatus: { $ne: "cancelled" },
  };

  if (room) {
    studentQuery["roomDetails.roomNumber"] = new RegExp(room.trim(), "i");
  }

  const students = await User.find(studentQuery, {
    "basicInfo.userId": 1,
    "basicInfo.fullName": 1,
    "basicInfo.email": 1,
    "basicInfo.phone": 1,
    "basicInfo.biometricCardNo": 1,
    "roomDetails.roomNumber": 1,
    "profilePhoto.url": 1,
  })
    .sort({ "roomDetails.roomNumber": 1, "basicInfo.fullName": 1 })
    .lean();

  // 2. Fetch all punches for target date
  const punches = await AttendanceLog.find({ dateStr: targetDate })
    .sort({ punchTime: 1 })
    .lean();

  // Group punches by student ID (and by cardNo for unmapped cards)
  const punchesByStudentId = new Map();
  const punchesByCardNo = new Map();

  for (const p of punches) {
    if (p.student) {
      const sId = p.student.toString();
      if (!punchesByStudentId.has(sId)) punchesByStudentId.set(sId, []);
      punchesByStudentId.get(sId).push(p);
    }
    if (p.cardNo) {
      if (!punchesByCardNo.has(p.cardNo)) punchesByCardNo.set(p.cardNo, []);
      punchesByCardNo.get(p.cardNo).push(p);
    }
  }

  // 3. Assemble student attendance rows
  let presentCount = 0;
  let lateCount = 0;
  let absentCount = 0;

  const records = [];

  for (const student of students) {
    const sId = student._id.toString();
    const cardNo = student.basicInfo?.biometricCardNo;
    const studentPunches = punchesByStudentId.get(sId) || (cardNo ? punchesByCardNo.get(cardNo) : null) || [];

    let computedStatus = "ABSENT";
    let firstIn = null;
    let lastOut = null;
    let totalMinutes = 0;

    if (studentPunches.length > 0) {
      const sorted = [...studentPunches].sort((a, b) => new Date(a.punchTime) - new Date(b.punchTime));
      const firstPunch = sorted[0];
      const lastPunch = sorted[sorted.length - 1];

      firstIn = getISTTimeStr(firstPunch.punchTime);
      lastOut = sorted.length > 1 ? getISTTimeStr(lastPunch.punchTime) : firstIn;

      // Calculate time duration if multiple punches
      const diffMs = new Date(lastPunch.punchTime) - new Date(firstPunch.punchTime);
      totalMinutes = Math.max(0, Math.round(diffMs / (1000 * 60)));

      // Curfew / Late check: if first check-in is after 22:00 (10 PM) or after reporting time
      const hour = new Date(firstPunch.punchTime).getHours();
      if (hour >= 22 || hour < 5) {
        computedStatus = "LATE";
        lateCount++;
        presentCount++;
      } else {
        computedStatus = "PRESENT";
        presentCount++;
      }
    } else {
      absentCount++;
    }

    const record = {
      studentId: student._id,
      userId: student.basicInfo?.userId || "N/A",
      fullName: student.basicInfo?.fullName || "Unnamed Student",
      email: student.basicInfo?.email || "",
      phone: student.basicInfo?.phone || "",
      roomNumber: student.roomDetails?.roomNumber || "Unassigned",
      avatar: student.profilePhoto?.url || null,
      cardNo: cardNo || null,
      status: computedStatus,
      punchCount: studentPunches.length,
      firstIn,
      lastOut,
      hoursPresent: totalMinutes > 0 ? (totalMinutes / 60).toFixed(2) : "0.00",
      punches: studentPunches.map((p) => ({
        id: p._id,
        rawPunchId: p.rawPunchId,
        punchTime: p.punchTime,
        timeStr: getISTTimeStr(p.punchTime),
        inOut: p.inOut,
        source: p.source,
      })),
    };

    records.push(record);
  }

  // Filter records by search keyword
  let filteredRecords = records;
  if (search) {
    const s = search.toLowerCase();
    filteredRecords = filteredRecords.filter(
      (r) =>
        r.fullName.toLowerCase().includes(s) ||
        r.userId.toLowerCase().includes(s) ||
        r.roomNumber.toLowerCase().includes(s) ||
        (r.cardNo && r.cardNo.toLowerCase().includes(s))
    );
  }

  // Filter by status
  if (status && status !== "ALL") {
    filteredRecords = filteredRecords.filter((r) => r.status === status);
  }

  const totalStudents = students.length;
  const attendanceRate = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

  return {
    date: targetDate,
    summary: {
      totalStudents,
      presentCount,
      lateCount,
      absentCount,
      attendanceRate,
      totalPunchesToday: punches.length,
    },
    records: filteredRecords,
  };
}

/**
 * Get real-time stream of latest punches from database, enriched with student details.
 */
async function getLivePunches(limit = 50) {
  // Run a quick sync to pull any fresh punches from hardware
  try {
    await syncRecentPunches(30);
  } catch (err) {
    // Non-fatal
  }

  const logs = await AttendanceLog.find()
    .sort({ punchTime: -1 })
    .limit(Number(limit) || 50)
    .populate("student", "basicInfo roomDetails profilePhoto")
    .lean();

  return logs.map((log) => ({
    id: log._id,
    rawPunchId: log.rawPunchId,
    cardNo: log.cardNo,
    punchTime: log.punchTime,
    timeStr: getISTTimeStr(log.punchTime),
    dateStr: log.dateStr,
    inOut: log.inOut,
    deviceSerial: log.deviceSerial,
    machineNo: log.machineNo,
    source: log.source,
    status: log.status,
    notes: log.notes,
    student: log.student
      ? {
          id: log.student._id,
          userId: log.student.basicInfo?.userId,
          fullName: log.student.basicInfo?.fullName,
          email: log.student.basicInfo?.email,
          phone: log.student.basicInfo?.phone,
          roomNumber: log.student.roomDetails?.roomNumber || "Unassigned",
          avatar: log.student.profilePhoto?.url,
        }
      : log.userId
      ? {
          id: null,
          userId: log.userId,
          fullName: log.studentName || "Unassigned",
          roomNumber: log.roomNumber || "Unassigned",
        }
      : null,
  }));
}

/**
 * Get all unmapped biometric cards that have punched on the machine.
 * Helps the administrator identify unknown cards used at the turnstile / machine.
 */
async function getUnmappedCards() {
  // Trigger sync first so new cards appear
  try {
    await syncRecentPunches(50);
  } catch (err) {}

  const unmappedLogs = await AttendanceLog.find({
    $or: [{ student: null }, { student: { $exists: false } }],
  })
    .sort({ punchTime: -1 })
    .lean();

  const cardStats = new Map();
  for (const log of unmappedLogs) {
    if (!log.cardNo) continue;
    if (!cardStats.has(log.cardNo)) {
      cardStats.set(log.cardNo, {
        cardNo: log.cardNo,
        punchCount: 0,
        lastPunchTime: log.punchTime,
        lastDevice: log.deviceSerial,
        machineNo: log.machineNo,
      });
    }
    const stat = cardStats.get(log.cardNo);
    stat.punchCount++;
    if (new Date(log.punchTime) > new Date(stat.lastPunchTime)) {
      stat.lastPunchTime = log.punchTime;
    }
  }

  // Check if any of these were recently mapped to students
  const cardList = Array.from(cardStats.values());
  const mappedUsers = await User.find(
    { "basicInfo.biometricCardNo": { $in: cardList.map((c) => c.cardNo) } },
    { "basicInfo.biometricCardNo": 1 }
  ).lean();

  const mappedCardSet = new Set(
    mappedUsers.map((u) => u.basicInfo?.biometricCardNo)
  );

  return cardList
    .filter((c) => !mappedCardSet.has(c.cardNo))
    .sort((a, b) => new Date(b.lastPunchTime) - new Date(a.lastPunchTime));
}

/**
 * Map a biometric RFID card number to a specific student.
 * Retroactively associates past unmapped punches for this card with the student.
 */
async function mapCardToStudent(userId, cardNo) {
  if (!userId || !cardNo) {
    throw new BadRequestError("Both userId and cardNo are required");
  }

  const cleanCardNo = String(cardNo).trim();

  // Check if card is currently assigned to another student
  const existingHolder = await User.findOne({
    "basicInfo.biometricCardNo": cleanCardNo,
    "basicInfo.userId": { $ne: userId },
  });

  if (existingHolder) {
    throw new BadRequestError(
      `Card ${cleanCardNo} is already assigned to student ${existingHolder.basicInfo?.fullName} (${existingHolder.basicInfo?.userId})`
    );
  }

  const student = await User.findOne(buildStudentQuery(userId));

  if (!student) {
    throw new NotFoundError(`Student with ID ${userId} not found`);
  }

  student.basicInfo.biometricCardNo = cleanCardNo;
  await student.save();

  // Retroactively link past punches with this cardNo
  const updateResult = await AttendanceLog.updateMany(
    { cardNo: cleanCardNo },
    {
      $set: {
        student: student._id,
        userId: student.basicInfo?.userId,
        studentName: student.basicInfo?.fullName,
        roomNumber: student.roomDetails?.roomNumber || "Unassigned",
      },
    }
  );

  return {
    success: true,
    student: {
      userId: student.basicInfo?.userId,
      fullName: student.basicInfo?.fullName,
      cardNo: cleanCardNo,
    },
    retroactivelyUpdatedPunches: updateResult.modifiedCount,
  };
}

/**
 * Unmap / unbind a biometric card from a student.
 */
async function unmapCardFromStudent(userId) {
  const student = await User.findOne(buildStudentQuery(userId));

  if (!student) {
    throw new NotFoundError(`Student with ID ${userId} not found`);
  }

  const oldCard = student.basicInfo?.biometricCardNo;
  student.basicInfo.biometricCardNo = null;
  await student.save();

  return {
    success: true,
    message: `Card ${oldCard || "none"} unmapped from student ${student.basicInfo?.fullName}`,
  };
}

/**
 * Record a manual attendance punch (e.g. if student forgot card or punch failed).
 */
async function recordManualPunch(data, adminName = "Admin") {
  const { userId, punchTime, inOut = "In/Ou", reason = "" } = data;

  if (!userId) {
    throw new BadRequestError("Student userId is required");
  }

  const student = await User.findOne(buildStudentQuery(userId));

  if (!student) {
    throw new NotFoundError(`Student with ID ${userId} not found`);
  }

  const parsedTime = punchTime ? new Date(punchTime) : new Date();
  const dateStr = getISTDateStr(parsedTime);

  const newLog = await AttendanceLog.create({
    cardNo: student.basicInfo?.biometricCardNo || `MANUAL-${student.basicInfo?.userId}`,
    student: student._id,
    userId: student.basicInfo?.userId,
    studentName: student.basicInfo?.fullName,
    roomNumber: student.roomDetails?.roomNumber || "Unassigned",
    punchTime: parsedTime,
    dateStr,
    inOut,
    deviceSerial: "MANUAL_ENTRY",
    machineNo: "0",
    source: "manual",
    status: "PRESENT",
    recordedBy: adminName,
    notes: reason || "Manual punch registered by Admin",
  });

  return newLog;
}

/**
 * Get punch ledger and attendance history for a single student.
 */
async function getStudentAttendanceHistory(userId, fromDate, toDate) {
  const student = await User.findOne(
    buildStudentQuery(userId),
    {
      "basicInfo.userId": 1,
      "basicInfo.fullName": 1,
      "basicInfo.email": 1,
      "basicInfo.phone": 1,
      "basicInfo.biometricCardNo": 1,
      "roomDetails.roomNumber": 1,
      "profilePhoto.url": 1,
    }
  ).lean();

  if (!student) {
    throw new NotFoundError(`Student with ID ${userId} not found`);
  }

  const query = {
    $or: [
      { student: student._id },
      { userId: student.basicInfo?.userId },
      ...(student.basicInfo?.biometricCardNo
        ? [{ cardNo: student.basicInfo.biometricCardNo }]
        : []),
    ],
  };

  if (fromDate || toDate) {
    query.punchTime = {};
    if (fromDate) query.punchTime.$gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      query.punchTime.$lte = end;
    }
  }

  const logs = await AttendanceLog.find(query).sort({ punchTime: -1 }).lean();

  // Aggregate days present
  const uniqueDates = new Set(logs.map((l) => l.dateStr));

  return {
    student,
    stats: {
      totalPunches: logs.length,
      daysPresent: uniqueDates.size,
      cardNo: student.basicInfo?.biometricCardNo || "Unassigned",
    },
    logs: logs.map((l) => ({
      id: l._id,
      punchTime: l.punchTime,
      timeStr: getISTTimeStr(l.punchTime),
      dateStr: l.dateStr,
      inOut: l.inOut,
      source: l.source,
      deviceSerial: l.deviceSerial,
      status: l.status,
      notes: l.notes,
    })),
  };
}

/**
 * Check biometric machine health and connectivity status.
 */
async function getHardwareStatus() {
  let isApiOnline = false;
  let deviceList = [];
  let apiMessage = "";

  try {
    const res = await fetchBiometricApi("help");
    isApiOnline = res && res.status === "success";
    apiMessage = res?.message || "";

    const devRes = await fetchBiometricApi("devices");
    if (devRes && devRes.status === "success" && Array.isArray(devRes.data)) {
      deviceList = devRes.data;
    }
  } catch (err) {
    isApiOnline = false;
  }

  const totalPunchesInDb = await AttendanceLog.countDocuments();
  const lastPunch = await AttendanceLog.findOne().sort({ punchTime: -1 }).lean();

  return {
    isOnline: isApiOnline,
    apiUrl: BIOMETRIC_API_URL,
    deviceSerial: "RSS202510129102",
    model: "Realtime RS 9 / RS 20 Terminal",
    receiverPort: 85,
    webApiPort: 80,
    apiStatus: isApiOnline ? "OPERATIONAL" : "OFFLINE",
    apiMessage,
    devices: deviceList,
    totalPunchesInDb,
    lastPunchTime: lastPunch ? lastPunch.punchTime : null,
    lastSyncTime: new Date(),
  };
}

module.exports = {
  fetchBiometricApi,
  syncRecentPunches,
  getDailyAttendanceSheet,
  getLivePunches,
  getUnmappedCards,
  mapCardToStudent,
  unmapCardFromStudent,
  recordManualPunch,
  getStudentAttendanceHistory,
  getHardwareStatus,
  getISTDateStr,
  getISTTimeStr,
};
