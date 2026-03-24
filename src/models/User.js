const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: [true, 'User ID is required'],
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'admin', 'accountant', 'manager', 'warden'],
      default: 'user',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended'],
      default: 'active',
    },
    lastLogin: {
      type: Date,
    },
    roomNumber: { type: String, trim: true, default: '' },
    roomType: {
      type: String,
      enum: ['', 'VIRAMAH Nexus', 'VIRAMAH Axis', 'VIRAMAH Collective', 'VIRAMAH Axis+'],
      default: '',
    },
    onboardingStatus: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'rejected'],
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'pending', 'approved', 'rejected'],
      default: 'unpaid',
    },
    documents: {
      idProof: { type: String, default: '' },
      addressProof: { type: String, default: '' },
      photo: { type: String, default: '' },
    },
    emergencyContact: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      relation: { type: String, default: '' },
    },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: ['', 'male', 'female', 'other'], default: '' },
    address: { type: String, default: '' },
    preferences: {
      diet: { type: String, enum: ['', 'vegetarian', 'non-vegetarian', 'vegan'], default: '' },
      sleepSchedule: { type: String, enum: ['', 'early-bird', 'night-owl', 'flexible'], default: '' },
      noise: { type: String, enum: ['', 'quiet', 'moderate', 'social'], default: '' },
    },
    messPackage: {
      type: String,
      enum: ['', 'full-board', 'partial-board', 'none'],
      default: '',
    },
    selectedRoom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare entered password with hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate JWT token
userSchema.methods.generateAuthToken = function () {
  return jwt.sign(
    { id: this._id, userId: this.userId, role: this.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

module.exports = mongoose.model('User', userSchema);
