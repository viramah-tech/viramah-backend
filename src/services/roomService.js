const mongoose = require("mongoose");
const RoomType = require("../models/RoomType");
const { NotFoundError, ValidationError } = require("../utils/errors");

const getAllRoomTypes = async () => {
  // Treat missing/legacy isActive values as active unless explicitly false.
  let rooms = await RoomType.find({ isActive: { $ne: false } }).sort({
    discountedPrice: -1,
    basePrice: -1,
  });

  // Fallback for older datasets where isActive is absent or typed inconsistently.
  if (!rooms.length) {
    rooms = await RoomType.find({}).sort({ discountedPrice: -1, basePrice: -1 });
  }

  return rooms;
};

const getRoomTypeById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ValidationError("Invalid room type id");
  }
  const room = await RoomType.findById(id);
  if (!room) throw new NotFoundError("Room type not found");
  return room;
};

module.exports = { getAllRoomTypes, getRoomTypeById };
