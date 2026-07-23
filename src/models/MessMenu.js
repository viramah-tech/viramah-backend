const mongoose = require("mongoose");

const mealOptionSchema = new mongoose.Schema({
  optionId: { type: String, required: true }, // e.g. "opt_b_1", "opt_b_2"
  title: { type: String, required: true }, // e.g. "North Indian Paratha Special"
  description: { type: String, default: "" },
  dishes: [{ type: String }], // Dynamic list of dishes e.g. ["Aloo Paratha", "Curd", "Pickle", "Tea"]
  isVeg: { type: Boolean, default: true },
  image: { type: String, default: "" },
  calories: { type: Number, default: 0 },
});

const messMenuSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, index: true }, // Format: YYYY-MM-DD
    dayOfWeek: { type: String, required: true }, // e.g. "Monday"
    meals: {
      breakfast: {
        startTime: { type: String, default: "08:00 AM" },
        endTime: { type: String, default: "10:00 AM" },
        votingDeadline: { type: String, default: "22:00" }, // 10 PM previous day
        options: [mealOptionSchema],
      },
      snacks: {
        startTime: { type: String, default: "05:00 PM" },
        endTime: { type: String, default: "06:30 PM" },
        votingDeadline: { type: String, default: "14:00" }, // 2 PM same day
        options: [mealOptionSchema],
      },
      dinner: {
        startTime: { type: String, default: "08:00 PM" },
        endTime: { type: String, default: "10:00 PM" },
        votingDeadline: { type: String, default: "17:00" }, // 5 PM same day
        options: [mealOptionSchema],
      },
    },
    published: { type: Boolean, default: true },
    createdBy: { type: String, default: "Mess Incharge" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MessMenu", messMenuSchema);
