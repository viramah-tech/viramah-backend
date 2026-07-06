const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema(
  {
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
      enum: ["PAYMENT", "DOCUMENT", "ROOM", "FINE", "PRICING", "SECURITY", "SYSTEM"],
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    performedBy: {
      userId: { type: String, required: true, index: true },
      fullName: { type: String, required: true },
      role: { type: String, required: true },
    },
    target: {
      targetId: { type: String, index: true }, // e.g. student userId, room id, pricing id
      targetName: { type: String },           // e.g. student's name, room number
    },
    changes: {
      oldValue: { type: mongoose.Schema.Types.Mixed },
      newValue: { type: mongoose.Schema.Types.Mixed },
      fields: [{ type: String }],
    },
    clientInfo: {
      ipAddress: { type: String },
      userAgent: { type: String },
    },
    status: {
      type: String,
      enum: ["success", "failed"],
      default: "success",
    },
    error: {
      type: String,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Index for pagination and sorting
AuditLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model("AuditLog", AuditLogSchema);
