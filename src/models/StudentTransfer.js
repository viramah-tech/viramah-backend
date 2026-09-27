const mongoose = require("mongoose");
const { Schema } = mongoose;

const studentTransferSchema = new Schema(
  {
    transferId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    fromStudent: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    fromStudentUserId: {
      type: String,
      required: true,
      index: true,
    },
    fromStudentName: {
      type: String,
      default: "",
    },
    fromStudentEmail: {
      type: String,
      default: "",
    },
    toStudent: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    toStudentUserId: {
      type: String,
      required: true,
      index: true,
    },
    toStudentName: {
      type: String,
      default: "",
    },
    toStudentEmail: {
      type: String,
      default: "",
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    targetCategory: {
      type: String,
      enum: ["room_rent", "security_deposit", "mess", "transport", "fine", "booking", "hostel_transfer"],
      default: "room_rent",
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    markFromStudentAsCancelled: {
      type: Boolean,
      default: false,
    },
    freedRoom: {
      roomNumber: { type: String, default: null },
      bedNumber: { type: String, default: null },
    },
    creditedPaymentId: {
      type: String,
      default: "",
    },
    authorizedBy: {
      userId: { type: String, required: true },
      role: { type: String, required: true },
      fullName: { type: String, default: "" },
    },
    status: {
      type: String,
      enum: ["completed", "failed", "reversed"],
      default: "completed",
      index: true,
    },
    transferDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.StudentTransfer ||
  mongoose.model("StudentTransfer", studentTransferSchema);
