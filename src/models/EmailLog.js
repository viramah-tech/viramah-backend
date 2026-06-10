const mongoose = require("mongoose");
const { Schema } = mongoose;

const emailLogSchema = new Schema(
  {
    recipient: {
      userId: { type: String, required: true },
      email: { type: String, required: true, lowercase: true, trim: true },
      fullName: { type: String, default: "" },
    },
    subject: { type: String, required: true },
    heading: { type: String, default: "" },
    body: { type: String, required: true },
    type: {
      type: String,
      enum: ["payment", "document", "custom"],
      required: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "sent", "delivered", "failed", "cancelled"],
      default: "sent",
      index: true,
    },
    resendId: { type: String, index: true, sparse: true },
    scheduledAt: { type: Date, default: null, index: true },
    sentAt: { type: Date, default: null },
    error: { type: String, default: null },
    sentBy: {
      userId: { type: String, required: true },
      fullName: { type: String, default: "" },
      role: { type: String, required: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.models.EmailLog || mongoose.model("EmailLog", emailLogSchema);
