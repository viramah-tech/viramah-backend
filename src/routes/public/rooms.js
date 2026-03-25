const express = require('express');
const {
  getAllRoomTypes,
  getRoomTypeByName,
  getRoomTypeAvailability,
} = require('../../controllers/public/roomTypeController');

const router = express.Router();

// GET /api/public/rooms — all active room types
router.get('/', getAllRoomTypes);

// GET /api/public/rooms/:name — specific room type
router.get('/:name', getRoomTypeByName);

// GET /api/public/rooms/:name/availability — availability check
router.get('/:name/availability', getRoomTypeAvailability);

module.exports = router;
