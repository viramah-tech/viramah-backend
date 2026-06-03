const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    roomNumber: { type: String, required: true, unique: true },
    capacity: { type: Number, required: true, default: 1 },
    currentOccupancy: { type: Number, default: 0 },
    roomType: { type: mongoose.Schema.Types.ObjectId, ref: "RoomType", required: true },
    status: {
      type: String,
      enum: ["Available", "Full", "Maintenance"],
      default: "Available",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Room", roomSchema);