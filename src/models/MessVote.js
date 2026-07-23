const mongoose = require("mongoose");

const messVoteSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true }, // Format: YYYY-MM-DD
    userId: { type: String, required: true, index: true }, // Student RES-ID
    studentName: { type: String, default: "Student" },
    roomNumber: { type: String, default: "" },
    votes: {
      breakfast: { type: String, default: null }, // optionId selected
      snacks: { type: String, default: null },
      dinner: { type: String, default: null },
    },
  },
  { timestamps: true }
);

// Prevent duplicate votes per student per date
messVoteSchema.index({ date: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("MessVote", messVoteSchema);
