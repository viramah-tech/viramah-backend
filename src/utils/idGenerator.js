const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.models.Counter || mongoose.model("Counter", counterSchema);

const generateUserId = async () => {
  // Auto-heal the sequence: Check the highest existing RES user ID
  const User = mongoose.models.User;
  if (User) {
    const lastUser = await User.findOne({ "basicInfo.userId": /^RES/ })
      .sort({ "basicInfo.userId": -1 })
      .select("basicInfo.userId")
      .lean();
    if (lastUser && lastUser.basicInfo.userId) {
      const maxSeq = parseInt(lastUser.basicInfo.userId.replace("RES", ""), 10);
      if (!isNaN(maxSeq)) {
        const c = await Counter.findById("userId");
        if (!c || c.seq < maxSeq) {
          await Counter.findByIdAndUpdate(
            "userId",
            { $set: { seq: maxSeq } },
            { upsert: true }
          );
        }
      }
    }
  }

  const counter = await Counter.findByIdAndUpdate(
    "userId",
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return "RES" + String(counter.seq).padStart(6, "0");
};

module.exports = { generateUserId, Counter };
