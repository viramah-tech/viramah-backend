const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.models.Counter || mongoose.model("Counter", counterSchema);

const generateUserId = async () => {
  const counter = await Counter.findByIdAndUpdate(
    "userId",
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return "RES" + String(counter.seq).padStart(6, "0");
};

module.exports = { generateUserId, Counter };
