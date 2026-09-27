const SystemSettings = require("../models/SystemSettings");

/**
 * Get current system settings, creating default record if none exists
 */
const getSystemSettings = async () => {
  let settings = await SystemSettings.findOne();
  if (!settings) {
    settings = await SystemSettings.create({
      warden: {
        email: (process.env.HOSTEL_INCHARGE_EMAIL || "admin@viramah.com").toLowerCase().trim(),
        password: process.env.HOSTEL_INCHARGE_PASSWORD || "admin123",
        fullName: "Viramah Hostel Incharge",
        phone: "9999999999",
        enabled: true,
      },
      accountant: {
        email: (process.env.ACCOUNTANT_EMAIL || "accountant@viramah.com").toLowerCase().trim(),
        password: process.env.ACCOUNTANT_PASSWORD || "accountant123",
        fullName: "Viramah Head Accountant",
        enabled: true,
      },
      manager: {
        email: (process.env.MANAGER_EMAIL || "manager@viramah.com").toLowerCase().trim(),
        password: process.env.MANAGER_PASSWORD || "manager123",
        fullName: "Viramah General Manager",
        phone: "9876543210",
        enabled: true,
      },
      operations: {
        curfewTime: "21:00",
        biometricSyncIntervalSec: 30,
        autoApplyDailyFines: true,
        salesCanVerifyDocuments: true,
      },
    });
  }
  return settings;
};

/**
 * Update system settings (Admin only)
 */
const updateSystemSettings = async (updateData) => {
  let settings = await SystemSettings.findOne();
  if (!settings) {
    settings = new SystemSettings();
  }

  if (updateData.warden) {
    settings.warden = {
      ...(settings.warden ? settings.warden.toObject() : {}),
      ...updateData.warden,
      email: (updateData.warden.email || settings.warden?.email || "").toLowerCase().trim(),
    };
  }

  if (updateData.accountant) {
    settings.accountant = {
      ...(settings.accountant ? settings.accountant.toObject() : {}),
      ...updateData.accountant,
      email: (updateData.accountant.email || settings.accountant?.email || "").toLowerCase().trim(),
    };
  }

  if (updateData.manager) {
    settings.manager = {
      ...(settings.manager ? settings.manager.toObject() : {}),
      ...updateData.manager,
      email: (updateData.manager.email || settings.manager?.email || "").toLowerCase().trim(),
    };
  }

  if (updateData.operations) {
    settings.operations = {
      ...(settings.operations ? settings.operations.toObject() : {}),
      ...updateData.operations,
    };
  }

  await settings.save();
  return settings;
};

/**
 * Update Warden credentials specifically
 */
const updateWardenCredentials = async ({ email, password, fullName, phone, enabled }) => {
  let settings = await getSystemSettings();
  if (email) settings.warden.email = email.toLowerCase().trim();
  if (password) settings.warden.password = password;
  if (fullName) settings.warden.fullName = fullName.trim();
  if (phone) settings.warden.phone = phone.trim();
  if (typeof enabled === "boolean") settings.warden.enabled = enabled;

  await settings.save();
  return settings.warden;
};

/**
 * Update Manager credentials specifically
 */
const updateManagerCredentials = async ({ email, password, fullName, phone, enabled }) => {
  let settings = await getSystemSettings();
  if (!settings.manager) settings.manager = {};
  if (email) settings.manager.email = email.toLowerCase().trim();
  if (password) settings.manager.password = password;
  if (fullName) settings.manager.fullName = fullName.trim();
  if (phone) settings.manager.phone = phone.trim();
  if (typeof enabled === "boolean") settings.manager.enabled = enabled;

  await settings.save();
  return settings.manager;
};

module.exports = {
  getSystemSettings,
  updateSystemSettings,
  updateWardenCredentials,
  updateManagerCredentials,
};
