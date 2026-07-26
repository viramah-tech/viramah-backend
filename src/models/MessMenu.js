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
        options: [mealOptionSchema],
      },
      snacks: {
        startTime: { type: String, default: "05:00 PM" },
        endTime: { type: String, default: "06:30 PM" },
        options: [mealOptionSchema],
      },
      dinner: {
        startTime: { type: String, default: "08:00 PM" },
        endTime: { type: String, default: "10:00 PM" },
        options: [mealOptionSchema],
      },
    },
    published: { type: Boolean, default: true },
    createdBy: { type: String, default: "Mess Incharge" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.MessMenu || mongoose.model("MessMenu", messMenuSchema);
