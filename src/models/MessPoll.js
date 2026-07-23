const mongoose = require("mongoose");

const pollOptionSchema = new mongoose.Schema({
  optionId: { type: String, required: true }, // e.g. "plan_a", "plan_b"
  title: { type: String, required: true }, // e.g. "Plan A — North & South Blend"
  description: { type: String, default: "" },
  image: { type: String, default: "" }, // Uploaded Monthly Menu Graphic/Image
  highlights: [{ type: String }], // Dish highlights
});

const messPollSchema = new mongoose.Schema(
  {
    month: { type: String, required: true }, // e.g. "August 2026"
    title: { type: String, required: true }, // e.g. "Monthly Mess Menu Selection Poll — August"
    status: { type: String, enum: ["active", "closed", "published"], default: "active" },
    closingDate: { type: String, default: "" }, // YYYY-MM-DD
    options: [pollOptionSchema],
    winningOptionId: { type: String, default: null },
    createdBy: { type: String, default: "Mess Incharge" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MessPoll", messPollSchema);
