const mongoose = require("mongoose");

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: "" },
    updatedBy: { type: String, default: "System" },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const maintenanceRequestSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      unique: true,
      required: true,
    },
    studentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    studentName: { type: String, required: true },
    roomNumber: { type: String, default: "N/A" },
    phone: { type: String, default: "" },

    department: {
      type: String,
      enum: ["software", "civil", "electric", "other"],
      required: true,
      index: true,
    },
    issueTitle: { type: String, required: true },
    description: { type: String, default: "" },

    priority: {
      type: String,
      enum: ["normal", "high", "urgent"],
      default: "normal",
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "assigned", "in_progress", "resolved", "closed"],
      default: "pending",
      index: true,
    },

    images: [{ type: String }], // S3 URLs

    assignedTo: { type: String, default: "" },
    adminNotes: { type: String, default: "" },

    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },

    statusHistory: [statusHistorySchema],
  },
  { timestamps: true }
);

// Auto-generate ticketId before validation
maintenanceRequestSchema.pre("validate", async function (next) {
  if (!this.ticketId) {
    const count = await mongoose.model("MaintenanceRequest").countDocuments();
    this.ticketId = `MR-${String(count + 1).padStart(5, "0")}`;
  }
  next();
});

maintenanceRequestSchema.index({ createdAt: -1 });
maintenanceRequestSchema.index({ ticketId: 1 });

module.exports = mongoose.model("MaintenanceRequest", maintenanceRequestSchema);
