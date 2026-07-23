const mongoose = require("mongoose");

const messPollVoteSchema = new mongoose.Schema(
  {
    pollId: { type: mongoose.Schema.Types.ObjectId, ref: "MessPoll", required: true, index: true },
    userId: { type: String, required: true, index: true }, // Student RES-ID
    studentName: { type: String, default: "Student" },
    roomNumber: { type: String, default: "" },
    optionId: { type: String, required: true }, // Selected plan_a / plan_b / plan_c
  },
  { timestamps: true }
);

// Prevent duplicate votes per student per poll
messPollVoteSchema.index({ pollId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("MessPollVote", messPollVoteSchema);
