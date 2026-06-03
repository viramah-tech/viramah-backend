const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, required: true },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    country: { type: String, default: "" },
    source: { type: String, default: "website" },
    status: {
      type: String,
      enum: ["New", "Contacted", "In Progress", "Converted", "Lost"],
      default: "New",
    },
    notes: { type: String, default: "" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "SalesAgent", default: null }
  },
  { timestamps: true }
);

leadSchema.pre("save", async function (next) {
  if (this.isNew && !this.assignedTo) {
    try {
      const SalesAgent = mongoose.model("SalesAgent");
      const activeAgents = await SalesAgent.find({ accountStatus: "active" }).sort({ createdAt: 1 });
      if (activeAgents.length > 0) {
        // Find the last lead that was assigned to a sales agent
        const lastLead = await mongoose.model("Lead").findOne({ assignedTo: { $ne: null } }).sort({ createdAt: -1 });
        let nextAgentId = activeAgents[0]._id;
        
        if (lastLead && lastLead.assignedTo) {
          const lastAgentIndex = activeAgents.findIndex(
            (agent) => agent._id.toString() === lastLead.assignedTo.toString()
          );
          if (lastAgentIndex !== -1) {
            const nextIndex = (lastAgentIndex + 1) % activeAgents.length;
            nextAgentId = activeAgents[nextIndex]._id;
          }
        }
        this.assignedTo = nextAgentId;
      }
    } catch (err) {
      console.error("Error in lead round-robin assignment:", err);
    }
  }
  next();
});

module.exports = mongoose.model("Lead", leadSchema);