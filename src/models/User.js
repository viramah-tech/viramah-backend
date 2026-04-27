const mongoose = require("mongoose");

const { Schema } = mongoose;

const idProofSubSchema = new Schema(
  {
    idType: {
      type: String,
      enum: ["aadhaar", "pan", "passport", "driving_license", "voter_id", null],
      default: null,
    },
    idNumber: String,
    frontImage: String,
    backImage: String,
  },
  { _id: false }
);

const basicInfoSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    fullName: String,
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, default: "", index: true }, // Collected later in verify-contact
    gender: { type: String, enum: ["male", "female", "other", null], default: null },
    dateOfBirth: Date,
    address: String, // Store as plain string for flexibility
    salesAgent: { type: String, default: "" }, // Track who made the account
  },
  { _id: false }
);

const profilePhotoSchema = new Schema(
  {
    url: String,
    uploadedAt: Date,
  },
  { _id: false }
);

const guardianSchema = new Schema(
  {
    fullName: String,
    relation: String,
    phone: String,
    alternatePhone: String,
    idProof: idProofSubSchema,
  },
  { _id: false }
);

const roomDetailsSchema = new Schema(
  {
    roomType: { type: Schema.Types.ObjectId, ref: "RoomType", default: null },
    roomNumber: String,
    allocationDate: Date,
    status: {
      type: String,
      enum: ["unassigned", "assigned", "checked_in", "checked_out"],
      default: "unassigned",
    },
    includeMess: { type: Boolean, default: false },
    includeTransport: { type: Boolean, default: false },
  },
  { _id: false }
);

const verificationSchema = new Schema(
  {
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: true },
    documentVerified: { type: Boolean, default: false },
    documentVerificationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    documentRejectionReason: { type: String, default: null },
    otp: String,
    otpExpiresAt: Date,
    otpAttempts: { type: Number, default: 0 },
    otpVerified: { type: Boolean, default: false },
  },
  { _id: false }
);

const onboardingSchema = new Schema(
  {
    currentStep: {
      type: String,
      enum: [
        "compliance",
        "verification",
        "personal_details",
        "guardian_details",
        "room_selection",
        "review",
        "booking_payment",
        "final_payment",
        "completed",
      ],
      default: "compliance",
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  { _id: false }
);

const paymentBreakdownSchema = new Schema(
  {
    registrationFee: { type: Number, default: 0 },
    securityDeposit: { type: Number, default: 0 },
    roomRent: { type: Number, default: 0 },
    messFee: { type: Number, default: 0 },
    transportFee: { type: Number, default: 0 },
  },
  { _id: false }
);

const paymentAmountsSchema = new Schema(
  {
    totalAmount: { type: Number, required: true },
  },
  { _id: false }
);

const paymentProofSchema = new Schema(
  {
    url: String,
    uploadedAt: Date,
  },
  { _id: false }
);

const paymentRecordSchema = new Schema(
  {
    paymentId: { type: String, required: true, index: true },
    paymentType: {
      type: String,
      enum: ["booking", "full", "half"],
      required: true,
    },
    category: {
      type: String,
      enum: ["booking", "security_deposit", "room_rent", "mess", "transport", null],
      default: null,
    },
    method: {
      type: String,
      enum: ["upi", "bank_transfer", "cash"],
      required: true,
    },
    transactionId: { type: String, required: true },
    proof: paymentProofSchema,
    amounts: paymentAmountsSchema,
    breakdown: paymentBreakdownSchema,
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: String,
    reviewedAt: Date,
    rejectionReason: String,
    paidAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ledgerEntrySchema = new Schema(
  {
    total: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
  },
  { _id: false }
);

const roomRentLedgerSchema = new Schema(
  {
    total: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    remaining: { type: Number, default: 0 },
    fullPaymentDiscountPct: { type: Number, default: 40 },
    halfPaymentDiscountPct: { type: Number, default: 25 },
    appliedDiscountValue: { type: Number, default: 0 },
    customRackRate: { type: Number },
    selectedPlan: { type: String, enum: ["pending", "full", "half"], default: "pending" }
  },
  { _id: false }
);

const paymentSummarySchema = new Schema(
  {
    registrationFee: { type: ledgerEntrySchema, default: () => ({}) },
    securityDeposit: { type: ledgerEntrySchema, default: () => ({}) },
    roomRent: { type: roomRentLedgerSchema, default: () => ({}) },
    messFee: { type: ledgerEntrySchema, default: () => ({}) },
    transportFee: { type: ledgerEntrySchema, default: () => ({}) },
    grandTotal: { type: ledgerEntrySchema, default: () => ({}) },
    isFullyPaid: { type: Boolean, default: false },
  },
  { _id: false }
);

const paymentDeadlineSchema = new Schema(
  {
    startedAt: Date,
    expiresAt: Date,
    extensionRequested: { type: Boolean, default: false },
    extensionGrantedUntil: Date,
    extensionRequestedAt: Date,
    extensionReason: String,
    refundRequestedAt: Date,
    refundReason: String,
    cancellationRequestedAt: Date,
    cancellationReason: String,
  },
  { _id: false }
);

const referralHistoryItem = new Schema(
  {
    userId: String,
    creditedAmount: Number,
    creditedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const referralSchema = new Schema(
  {
    code: { type: String, unique: true, sparse: true, index: true },
    referredBy: String,
    creditsEarned: { type: Number, default: 0 },
    creditsUsed: { type: Number, default: 0 },
    referralCount: { type: Number, default: 0 },
    history: { type: [referralHistoryItem], default: [] },
  },
  { _id: false }
);

const complianceSchema = new Schema(
  {
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: Date,
    termsVersion: String,
    privacyPolicyAccepted: { type: Boolean, default: false },
    privacyAcceptedAt: Date,
    privacyVersion: String,
  },
  { _id: false }
);

const authSchema = new Schema(
  {
    passwordHash: { type: String, required: true },
    lastLogin: Date,
    loginAttempts: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    basicInfo: { type: basicInfoSchema, required: true },
    profilePhoto: profilePhotoSchema,
    userIdProof: idProofSubSchema,
    guardianDetails: guardianSchema,
    roomDetails: { type: roomDetailsSchema, default: () => ({}) },
    verification: { type: verificationSchema, default: () => ({}) },
    onboarding: { type: onboardingSchema, default: () => ({}) },
    paymentDetails: { type: [paymentRecordSchema], default: [] },
    paymentSummary: { type: paymentSummarySchema, default: () => ({}) },
    paymentDeadline: paymentDeadlineSchema,
    referral: { type: referralSchema, default: () => ({}) },
    compliance: { type: complianceSchema, default: () => ({}) },
    auth: { type: authSchema, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user", index: true },
    accountStatus: {
      type: String,
      enum: ["pending", "active", "suspended", "blocked"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

userSchema.index({ "basicInfo.email": 1 }, { unique: true });

const generateReferralCode = (seed) => {
  const base = (seed || "").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(-4) || "USER";
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VIR${base}${rand}`;
};

userSchema.pre("save", function (next) {
  if (!this.referral) this.referral = {};
  if (!this.referral.code && this.basicInfo?.userId) {
    this.referral.code = generateReferralCode(this.basicInfo.userId);
  }
  next();
});

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
