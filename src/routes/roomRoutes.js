const express = require("express");
const roomService = require("../services/roomService");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const rooms = await roomService.getAllRoomTypes();
    res.json({ success: true, data: { rooms } });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const room = await roomService.getRoomTypeById(req.params.id);
    res.json({ success: true, data: { room } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
