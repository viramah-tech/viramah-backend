const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Generates a unique referral code string (without the VIR- prefix).
 * Uses 4 random bytes, hex-encoded, uppercased, limited to 6 chars.
 * @returns {string} 6-character alphanumeric string
 */
const generateReferralSuffix = () =>
  crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);

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
    phone: { type: String, trim: true, default: '' },
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
    documentVerificationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    moveInStatus: {
      type: String,
      enum: ['not_started', 'completed'],
      default: 'not_started',
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

    // ── Referral System ──────────────────────────────────────────────────────
    /** Auto-generated unique code. Format: VIR-XXXXXX (6 alphanumeric chars). */
    referralCode: {
      type: String,
      unique: true,
      sparse: true, // allows null/undefined without unique constraint violation
      trim: true,
      uppercase: true,
    },
    /** Referral code the user entered at onboarding (from another user). Nullable. */
    referredBy: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    /** Accumulated referral credits (in INR). Each successful referral adds referralBonus. */
    referralCredit: { type: Number, default: 0, min: 0 },

    // ── Payment Preferences (set during onboarding) ───────────────────────
    /** Payment mode selected by the user during onboarding. */
    paymentMode: {
      type: String,
      enum: ['full', 'half', 'deposit'],
      default: null,
    },
    /** Add-ons selected by the user during onboarding. */
    selectedAddOns: {
      transport: { type: Boolean, default: false },
      mess:      { type: Boolean, default: false },
      messLumpSum: { type: Boolean, default: false }, // only valid for full payment mode
    },

    // ── Tenure Tracking ───────────────────────────────────────────────────
    /** Start date of the 11-month tenure (set when first payment is initiated). */
    tenureStartDate: { type: Date, default: null },
    /** End date of the tenure (tenureStartDate + 11 months). */
    tenureEndDate:   { type: Date, default: null },

    // ── Contact Verification ──────────────────────────────────────────────────
    emailVerified:        { type: Boolean, default: false },
    emailVerifiedAt:      { type: Date, default: null },
    emailOtp:             { type: String, default: null },
    emailOtpExpiresAt:    { type: Date, default: null },
    emailOtpAttempts:     { type: Number, default: 0 },

    phoneVerified:        { type: Boolean, default: false },
    phoneVerifiedAt:      { type: Date, default: null },
    phoneOtp:             { type: String, default: null },
    phoneOtpExpiresAt:    { type: Date, default: null },
    phoneOtpAttempts:     { type: Number, default: 0 },

    // ── Password Reset OTP ───────────────────────────────────────────────────
    passwordResetOtp:             { type: String, default: null },
    passwordResetOtpExpiresAt:    { type: Date, default: null },
    passwordResetOtpAttempts:     { type: Number, default: 0 },
    /** Set to true after OTP is verified; cleared after password is actually reset. */
    passwordResetVerified:        { type: Boolean, default: false },

    // ── Account Lockout (Brute-Force Protection) ──────────────────────────────
    /** Number of consecutive failed login attempts. Reset on successful login. */
    loginAttempts:            { type: Number, default: 0 },
    /** Account is locked until this timestamp. Null = not locked. */
    lockUntil:                { type: Date, default: null },

    // ── Terms & Privacy Policy Consent ────────────────────────────────────────
    /** Whether the user has explicitly accepted the Terms & Conditions. */
    termsAccepted:            { type: Boolean, default: false },
    /** Timestamp of terms acceptance. */
    termsAcceptedAt:          { type: Date, default: null },
    /** Version string of accepted terms (e.g. "v1.0" or "legacy" for migrated accounts). */
    termsVersion:             { type: String, default: null },
    /** Whether the user has explicitly accepted the Privacy Policy. */
    privacyPolicyAccepted:    { type: Boolean, default: false },
    /** Timestamp of privacy policy acceptance. */
    privacyPolicyAcceptedAt:  { type: Date, default: null },
    /** Version string of accepted privacy policy. */
    privacyPolicyVersion:     { type: String, default: null },
    /** IP address recorded at time of acceptance. */
    acceptanceIp:             { type: String, default: null },
    /** User-agent recorded at time of acceptance. */
    acceptanceUserAgent:      { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving + auto-generate referralCode if missing
userSchema.pre('save', async function () {
  // Hash password only if modified
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // Auto-generate referral code for new users (or users that somehow lack one)
  if (!this.referralCode) {
    // Retry up to 5 times to guarantee uniqueness
    let attempts = 0;
    while (attempts < 5) {
      const candidate = `VIR-${generateReferralSuffix()}`;
      // Use the model directly to check uniqueness (model may not be registered yet on first call,
      // so we use this.constructor which refers to the User model instance)
      const exists = await this.constructor.exists({ referralCode: candidate });
      if (!exists) {
        this.referralCode = candidate;
        break;
      }
      attempts += 1;
    }
    if (!this.referralCode) {
      // Extremely unlikely; fallback using timestamp salt
      this.referralCode = `VIR-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    }
  }
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
