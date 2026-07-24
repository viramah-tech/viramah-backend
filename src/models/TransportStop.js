const mongoose = require("mongoose");

const transportStopSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    pickupTime: {
      type: String,
      default: "07:30 AM",
      trim: true,
    },
    dropTime: {
      type: String,
      default: "05:30 PM",
      trim: true,
    },
    monthlyPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 2000,
    },
    yearlyPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 20000,
    },
    description: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.TransportStop ||
  mongoose.model("TransportStop", transportStopSchema);
