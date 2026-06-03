const mongoose = require("mongoose");

const { Schema } = mongoose;

const basicInfoSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    fullName: String,
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, default: "", index: true },
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

const verificationSchema = new Schema(
  {
    emailVerified: { type: Boolean, default: true },
    phoneVerified: { type: Boolean, default: true },
    documentVerified: { type: Boolean, default: true },
    otp: String,
    otpExpiresAt: Date,
    otpAttempts: { type: Number, default: 0 },
    otpVerified: { type: Boolean, default: true },
  },
  { _id: false }
);

const salesAgentSchema = new Schema(
  {
    basicInfo: { type: basicInfoSchema, required: true },
    verification: { type: verificationSchema, default: () => ({}) },
    auth: { type: authSchema, required: true },
    role: { type: String, default: "sales_member", index: true },
    accountStatus: {
      type: String,
      enum: ["pending", "active", "suspended", "blocked"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

salesAgentSchema.index({ "basicInfo.email": 1 }, { unique: true });

module.exports = mongoose.models.SalesAgent || mongoose.model("SalesAgent", salesAgentSchema);
