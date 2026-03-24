const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    roomNumber: {
      type: String,
      required: [true, 'Room number is required'],
      unique: true,
      trim: true,
    },
    floor: {
      type: Number,
      required: [true, 'Floor is required'],
    },
    roomType: {
      type: String,
      enum: ['VIRAMAH Nexus', 'VIRAMAH Axis', 'VIRAMAH Collective', 'VIRAMAH Axis+'],
      required: [true, 'Room type is required'],
    },
    occupancyType: {
      type: String,
      enum: ['single', 'double', 'triple'],
      required: true,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
    },
    currentOccupancy: {
      type: Number,
      default: 0,
      min: 0,
    },
    pricePerMonth: {
      type: Number,
      required: [true, 'Price is required'],
      min: 0,
    },
    securityDeposit: {
      type: Number,
      required: true,
      min: 0,
    },
    amenities: {
      wifi: { type: Boolean, default: true },
      ac: { type: Boolean, default: false },
      attachedBathroom: { type: Boolean, default: false },
      powerBackup: { type: Boolean, default: true },
    },
    size: { type: Number, default: 0 }, // sqft
    facing: { type: String, enum: ['', 'north', 'south', 'east', 'west'], default: '' },
    furniture: { type: String, default: 'furnished' },
    images: [{ type: String }],
    status: {
      type: String,
      enum: ['available', 'full', 'maintenance'],
      default: 'available',
    },
  },
  {
    timestamps: true,
  }
);

// Virtual: is room available?
roomSchema.virtual('isAvailable').get(function () {
  return this.status === 'available' && this.currentOccupancy < this.capacity;
});

roomSchema.set('toJSON', { virtuals: true });
roomSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Room', roomSchema);
