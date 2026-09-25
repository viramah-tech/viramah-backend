const mongoose = require("mongoose");

const systemSettingsSchema = new mongoose.Schema(
  {
    warden: {
      email: {
        type: String,
        default: "admin@viramah.com",
        trim: true,
        lowercase: true,
      },
      password: {
        type: String,
        default: "admin123",
      },
      fullName: {
        type: String,
        default: "Viramah Hostel Incharge",
      },
      phone: {
        type: String,
        default: "9999999999",
      },
      enabled: {
        type: Boolean,
        default: true,
      },
    },
    accountant: {
      email: {
        type: String,
        default: "accountant@viramah.com",
        trim: true,
        lowercase: true,
      },
      password: {
        type: String,
        default: "accountant123",
      },
      fullName: {
        type: String,
        default: "Viramah Head Accountant",
      },
      enabled: {
        type: Boolean,
        default: true,
      },
    },
    operations: {
      curfewTime: {
        type: String,
        default: "21:00", // 9:00 PM Curfew
      },
      biometricSyncIntervalSec: {
        type: Number,
        default: 30,
      },
      autoApplyDailyFines: {
        type: Boolean,
        default: true,
      },
      salesCanVerifyDocuments: {
        type: Boolean,
        default: true,
      },
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SystemSettings ||
  mongoose.model("SystemSettings", systemSettingsSchema);
