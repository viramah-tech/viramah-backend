const mongoose = require("mongoose");

const scheduledVisitSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true },
    visitDate: { type: Date, required: true },
    visitTime: { type: String, required: true },
    guests: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ["Pending", "Completed", "No Show", "Cancelled"],
      default: "Pending",
    },
    notes: { type: String, default: "" },
    assignedSalesMember: { type: mongoose.Schema.Types.ObjectId, ref: "SalesAgent", default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ScheduledVisit", scheduledVisitSchema);