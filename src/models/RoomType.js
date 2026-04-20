const mongoose = require("mongoose");

const roomTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    displayName: { type: String },
    capacity: { type: Number, required: true },
    features: { type: [String], default: [] },
    images: { type: [String], default: [] },
    basePrice: { type: Number, required: true },
    discountedPrice: { type: Number },
    totalRooms: { type: Number, required: true, default: 0 },
    bedsPerRoom: { type: Number, default: 0 },
    totalBeds: { type: Number, default: 0 },
    availableSeats: { type: Number, default: 0 },
    bookedSeats: { type: Number, default: 0 },
    // Kept for backward compatibility with older code paths.
    availableRooms: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    // Existing production data is stored in this collection name.
    collection: "RoomTypes",
  }
);

module.exports = mongoose.models.RoomType || mongoose.model("RoomType", roomTypeSchema);
