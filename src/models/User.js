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
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'resident', 'admin', 'manager', 'accountant', 'warden'], default: 'user' },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
    lastLogin: { type: Date },
    roomNumber: { type: String, trim: true, default: '' },
    messPackage: { type: String, trim: true, default: '' },
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
    idType: {
      type: String,
      enum: ['', 'aadhaar', 'passport', 'driving_license', 'voter_id'],
      default: '',
    },
    idNumber: { type: String, trim: true, default: '' },
    emergencyContact: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      relation: { type: String, default: '' },
    },
    parentDocuments: {
      idType: { type: String, enum: ['', 'aadhaar', 'passport', 'driving_license', 'voter_id'], default: '' },
      idNumber: { type: String, trim: true, default: '' },
      idFront: { type: String, default: '' },
      idBack: { type: String, default: '' },
    },
    dateOfBirth: { type: Date },
    gender: {
      type: String,
      enum: {
        values: ['', 'male', 'female', 'other'],
        message: '{VALUE} is not a supported gender'
      },
      default: '',
      validate: {
        validator: function(v) {
          if (this.onboardingStatus === 'completed' && !v) return false;
          return true;
        },
        message: 'Gender is required to complete onboarding'
      }
    },
    address: {
      type: String,
      default: '',
      validate: {
        validator: function(v) {
          if (this.onboardingStatus === 'completed' && (!v || v.trim() === '')) return false;
          return true;
        },
        message: 'Address is required to complete onboarding'
      }
    },
    roomTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RoomType',
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
