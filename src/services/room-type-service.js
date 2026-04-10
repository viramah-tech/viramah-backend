const RoomType = require('../models/RoomType');

/**
 * Fetch all active room types.
 * Returns only room types where isActive is true.
 */
const getAllActiveRoomTypes = async () => {
  const roomTypes = await RoomType.find({ isActive: true }).sort({ 'pricing.discounted': 1 });
  return roomTypes;
};

/**
 * Fetch a single room type by its name field.
 * @param {string} name - The room type name (e.g., "VIRAMAH Nexus")
 */
const getRoomTypeByName = async (name) => {
  const roomType = await RoomType.findOne({ name, isActive: true });
  if (!roomType) {
    const err = new Error('Room type not found');
    err.statusCode = 404;
    throw err;
  }
  return roomType;
};

/**
 * Get availability info for a specific room type by name.
 * Returns computed availability with integrity check.
 * @param {string} name - The room type name
 */
const getRoomTypeAvailability = async (name) => {
  const roomType = await RoomType.findOne({ name, isActive: true });
  if (!roomType) {
    const err = new Error('Room type not found');
    err.statusCode = 404;
    throw err;
  }

  // Dynamic integrity: ensure availableSeats = totalBeds - bookedSeats
  const computedAvailable = roomType.totalBeds - roomType.bookedSeats;
  const isConsistent = computedAvailable === roomType.availableSeats;

  // Auto-heal if inconsistent
  if (!isConsistent) {
    roomType.availableSeats = computedAvailable;
    await roomType.save();
  }

  return {
    name: roomType.name,
    displayName: roomType.displayName,
    totalBeds: roomType.totalBeds,
    bookedSeats: roomType.bookedSeats,
    availableSeats: computedAvailable,
    isAvailable: computedAvailable > 0,
  };
};

/**
 * Atomically increment bookedSeats for a room type during booking.
 * Uses $inc to prevent race conditions.
 * @param {string} name - The room type name
 * @param {number} delta - Number of seats to book (positive) or release (negative)
 * @returns {Object} Updated room type
 */
const adjustBookedSeats = async (name, delta) => {
  const roomType = await RoomType.findOneAndUpdate(
    {
      name,
      isActive: true,
      // Guard: only allow booking if seats remain (for positive delta)
      ...(delta > 0 ? { $expr: { $gt: [{ $subtract: ['$totalBeds', '$bookedSeats'] }, 0] } } : {}),
    },
    {
      $inc: { bookedSeats: delta },
    },
    { new: true, runValidators: true }
  );

  if (!roomType) {
    const err = new Error(
      delta > 0
        ? 'No available seats for this room type'
        : 'Room type not found or cannot release seats'
    );
    err.statusCode = 400;
    throw err;
  }

  // Recalculate availableSeats after $inc
  roomType.availableSeats = roomType.totalBeds - roomType.bookedSeats;
  await roomType.save();

  return roomType;
};

module.exports = {
  getAllActiveRoomTypes,
  getRoomTypeByName,
  getRoomTypeAvailability,
  adjustBookedSeats,
};
