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
    // Track temporary reservations that haven't completed payment
    holds: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      holdUntil: { type: Date, required: true },
    }],
  },
  {
    timestamps: true,
  }
);

// Virtual: active (non-expired) holds count
roomSchema.virtual('activeHoldsCount').get(function () {
  if (!this.holds || this.holds.length === 0) return 0;
  const now = new Date();
  return this.holds.filter(h => h.holdUntil > now).length;
});

// Virtual: is room available? (accounts for active holds)
roomSchema.virtual('isAvailable').get(function () {
  if (this.status !== 'available') return false;
  const effectiveOccupancy = this.currentOccupancy + this.activeHoldsCount;
  return effectiveOccupancy < this.capacity;
});

roomSchema.set('toJSON', { virtuals: true });
roomSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Room', roomSchema);
