const express = require("express");
const router = express.Router();
const messService = require("../services/messService");
const { upload, uploadToS3 } = require("../middleware/upload");

// Upload mess menu image
router.post("/upload-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "Image file is required" });
    }
    const url = await uploadToS3(req.file, `mess-menu/${Date.now()}`);
    res.json({ success: true, url });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1. Get today's menu
router.get("/menu/today", async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().split("T")[0];
    const menu = await messService.getMenuByDate(dateStr);
    res.json({ success: true, data: menu });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Get 7-day weekly menu
router.get("/menu/weekly", async (req, res) => {
  try {
    const startDate = req.query.startDate || new Date().toISOString().split("T")[0];
    const weeklyMenu = await messService.getWeeklyMenu(startDate);
    res.json({ success: true, data: weeklyMenu });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Get menu for a specific date
router.get("/menu/date/:date", async (req, res) => {
  try {
    const menu = await messService.getMenuByDate(req.params.date);
    res.json({ success: true, data: menu });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Admin / Mess Incharge: Create or update menu for a date
router.post("/menu", async (req, res) => {
  try {
    const { date, meals, published, updatedBy } = req.body;
    if (!date || !meals) {
      return res.status(400).json({ success: false, error: "Date and meals object are required" });
    }
    const updated = await messService.upsertMenu(date, { meals, published }, updatedBy || "Mess Incharge");
    res.json({ success: true, message: "Mess menu saved successfully", data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Student: Cast or update meal vote
router.post("/vote", async (req, res) => {
  try {
    const { userId, studentName, roomNumber, date, category, optionId } = req.body;
    if (!userId || !date || !category || !optionId) {
      return res.status(400).json({ success: false, error: "userId, date, category, and optionId are required" });
    }
    const vote = await messService.castStudentVote({
      userId,
      studentName,
      roomNumber,
      date,
      category,
      optionId,
    });
    res.json({ success: true, message: "Vote cast successfully", data: vote });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Student: Get own votes for a date
router.get("/my-vote", async (req, res) => {
  try {
    const { userId, date } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId query parameter is required" });
    }
    const dateStr = date || new Date().toISOString().split("T")[0];
    const vote = await messService.getStudentVote(userId, dateStr);
    res.json({ success: true, data: vote });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Admin / Incharge: Get voting tally & headcount results
router.get("/results", async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().split("T")[0];
    const results = await messService.getVotingResults(dateStr);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── MONTHLY MESS MENU POLLING ROUTES ──────────────────────────────────────────

// Get active monthly poll
router.get("/poll/active", async (req, res) => {
  try {
    const userId = req.query.userId || null;
    const pollData = await messService.getActiveMonthlyPoll(userId);
    res.json({ success: true, data: pollData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new monthly menu poll
router.post("/poll", async (req, res) => {
  try {
    const { month, title, closingDate, options, createdBy } = req.body;
    if (!options || !Array.isArray(options) || options.length === 0) {
      return res.status(400).json({ success: false, error: "Poll options array is required" });
    }
    const poll = await messService.createMonthlyPoll({ month, title, closingDate, options }, createdBy || "Mess Incharge");
    res.json({ success: true, message: "Monthly Mess Poll created & published", data: poll });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cast vote on monthly poll
router.post("/poll/vote", async (req, res) => {
  try {
    const { pollId, userId, studentName, roomNumber, optionId } = req.body;
    if (!pollId || !userId || !optionId) {
      return res.status(400).json({ success: false, error: "pollId, userId, and optionId are required" });
    }
    const vote = await messService.castMonthlyPollVote({ pollId, userId, studentName, roomNumber, optionId });
    res.json({ success: true, message: "Monthly Poll Vote recorded", data: vote });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Close poll and declare winner
router.post("/poll/close", async (req, res) => {
  try {
    const { pollId } = req.body;
    if (!pollId) {
      return res.status(400).json({ success: false, error: "pollId is required" });
    }
    const poll = await messService.closePollAndDeclareWinner(pollId);
    res.json({ success: true, message: "Poll closed and winning menu published", data: poll });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
