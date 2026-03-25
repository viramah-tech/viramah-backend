const roomTypeService = require('../../services/roomTypeService');
const { success, error } = require('../../utils/apiResponse');

/**
 * GET /api/public/rooms
 * List all active room types with pricing and availability
 */
const getAllRoomTypes = async (req, res, next) => {
  try {
    const roomTypes = await roomTypeService.getAllActiveRoomTypes();
    return success(res, { roomTypes }, 'Room types fetched');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/public/rooms/:name
 * Get a specific room type by name
 */
const getRoomTypeByName = async (req, res, next) => {
  try {
    const roomType = await roomTypeService.getRoomTypeByName(req.params.name);
    return success(res, { roomType }, 'Room type fetched');
  } catch (err) {
    if (err.statusCode === 404) return error(res, err.message, 404);
    next(err);
  }
};

/**
 * GET /api/public/rooms/:name/availability
 * Get availability details for a specific room type
 */
const getRoomTypeAvailability = async (req, res, next) => {
  try {
    const availability = await roomTypeService.getRoomTypeAvailability(req.params.name);
    return success(res, { availability }, 'Availability fetched');
  } catch (err) {
    if (err.statusCode === 404) return error(res, err.message, 404);
    next(err);
  }
};

module.exports = {
  getAllRoomTypes,
  getRoomTypeByName,
  getRoomTypeAvailability,
};
