const mongoose = require("mongoose");
const { Schema } = mongoose;

const attendanceLogSchema = new Schema(
  {
    rawPunchId: {
      type: Number,
      sparse: true,
      index: true,
    },
    cardNo: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    student: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    userId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    studentName: {
      type: String,
      default: null,
    },
    roomNumber: {
      type: String,
      default: null,
    },
    punchTime: {
      type: Date,
      required: true,
      index: true,
    },
    dateStr: {
      type: String,
      required: true,
      index: true, // Format: YYYY-MM-DD
    },
    inOut: {
      type: String,
      default: "In/Ou",
      trim: true,
    },
    deviceSerial: {
      type: String,
      default: "RSS202510129102",
      trim: true,
    },
    machineNo: {
      type: String,
      default: "1",
      trim: true,
    },
    source: {
      type: String,
      enum: ["biometric", "manual"],
      default: "biometric",
    },
    status: {
      type: String,
      enum: ["PRESENT", "LATE", "EARLY_DEPARTURE", "PUNCH", "FLAGGED"],
      default: "PUNCH",
    },
    recordedBy: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Prevent duplicate punch records from the machine by rawPunchId
attendanceLogSchema.index({ rawPunchId: 1 }, { unique: true, sparse: true });
// Fast query indexes
attendanceLogSchema.index({ dateStr: 1, student: 1 });
attendanceLogSchema.index({ cardNo: 1, punchTime: -1 });
attendanceLogSchema.index({ punchTime: -1 });

module.exports =
  mongoose.models.AttendanceLog ||
  mongoose.model("AttendanceLog", attendanceLogSchema);
