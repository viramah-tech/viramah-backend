const mongoose = require('mongoose');

const roomTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Room type name is required'],
      unique: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: [true, 'Display name is required'],
      trim: true,
    },
    capacity: {
      type: String,
      required: [true, 'Capacity description is required'],
      trim: true,
    },
    totalRooms: {
      type: Number,
      required: true,
      min: 0,
    },
    bedsPerRoom: {
      type: Number,
      required: true,
      min: 1,
    },
    totalBeds: {
      type: Number,
      required: true,
      min: 0,
    },
    availableSeats: {
      type: Number,
      required: true,
      min: 0,
    },
    bookedSeats: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    pricing: {
      original: {
        type: Number,
        required: [true, 'Original price is required'],
        min: 0,
      },
      discounted: {
        type: Number,
        required: [true, 'Discounted price is required'],
        min: 0,
      },
    },
    features: {
      type: [String],
      default: [],
    },
    images: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'roomtypes',
  }
);

// Ensure availableSeats stays consistent: totalBeds - bookedSeats
roomTypeSchema.pre('save', function (next) {
  this.availableSeats = this.totalBeds - this.bookedSeats;
  next();
});

module.exports = mongoose.model('RoomType', roomTypeSchema);
