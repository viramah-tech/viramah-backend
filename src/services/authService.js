const bcrypt = require("bcrypt");
const User = require("../models/User");
const { generateUserId } = require("../utils/idGenerator");
const {
  ConflictError,
  AuthError,
  NotFoundError,
  ValidationError,
} = require("../utils/errors");
const { sendWelcomeEmail, sendPasswordResetOtp } = require("./emailService");

const SALT_ROUNDS = 10;

const normalizeLoginIdentifier = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[0-9+\- ]{7,15}$/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase();
};

const findUserByIdentifier = async (identifier) => {
  const normalized = normalizeLoginIdentifier(identifier);
  if (!normalized) return null;

  const isPhone = /^[0-9+\- ]{7,15}$/.test(normalized);
  const query = isPhone
    ? {
        $or: [
          { "basicInfo.phone": normalized },
          { "basicInfo.email": normalized.toLowerCase() },
        ],
      }
    : { "basicInfo.email": normalized.toLowerCase() };

  let user = await User.findOne(query);
  if (!user) {
    const SalesAgent = require("../models/SalesAgent");
    user = await SalesAgent.findOne(query);
  }
  return user;
};

const sanitize = (user) => {
  if (!user) return null;
  const obj = user.toObject ? user.toObject() : user;
  if (obj.auth) delete obj.auth.passwordHash;
  if (obj.verification) delete obj.verification.otp;
  return obj;
};

const register = async ({ name, email, phone, password, salesAgent }) => {
  const normalizedEmail = email.toLowerCase().trim();
  const SalesAgent = require("../models/SalesAgent");
  
  const existingUser = await User.findOne({ "basicInfo.email": normalizedEmail });
  const existingAgent = await SalesAgent.findOne({ "basicInfo.email": normalizedEmail });
  if (existingUser || existingAgent) {
    throw new ConflictError("An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const userId = await generateUserId();

  const user = await User.create({
    basicInfo: {
      userId,
      fullName: name || "",
      email: normalizedEmail,
      phone: phone || "",
      salesAgent: salesAgent || "",
    },
    auth: { passwordHash },
    onboarding: { currentStep: "verification", startedAt: new Date() }, // User verifies email first
    accountStatus: "pending",
    role: "user",
  });

  sendWelcomeEmail(user, password).catch(() => {});

  return sanitize(user);
};

const login = async ({ email, phone, password }) => {
  const identifier = normalizeLoginIdentifier(email || phone);
  const normalizedEmail = identifier.toLowerCase();

  // Admin environment bypass
  if (
    process.env.ADMIN_EMAIL &&
    normalizedEmail === process.env.ADMIN_EMAIL.toLowerCase().trim() &&
    password === process.env.ADMIN_PASSWORD
  ) {
    return {
      basicInfo: {
        userId: "ADMIN",
        fullName: "Viramah Admin",
        email: normalizedEmail,
      },
      role: "admin",
      accountStatus: "active",
      onboarding: { currentStep: "completed" },
    };
  }

  // Accountant environment bypass
  if (process.env.ACCOUNTANT_EMAIL && normalizedEmail === process.env.ACCOUNTANT_EMAIL.toLowerCase().trim()) {
    if (password === process.env.ACCOUNTANT_PASSWORD) {
      return {
        basicInfo: {
          userId: "ACCOUNTANT_SYSTEM",
          fullName: "Viramah Accountant",
          email: normalizedEmail,
        },
        role: "accountant",
        accountStatus: "active",
        onboarding: { currentStep: "completed" },
      };
    } else {
      throw new AuthError("Invalid email or password");
    }
  }

  const user = await findUserByIdentifier(identifier);
  if (!user) {
    throw new AuthError("Invalid email or password");
  }
  
  if (user.accountStatus === "suspended" || user.accountStatus === "blocked") {
    throw new AuthError("Contact support@viramahstay.com");
  }

  if (user.auth?.isBlocked) {
    throw new AuthError("Account is blocked due to security reasons");
  }

  const match = await bcrypt.compare(password, user.auth.passwordHash);
  if (!match) {
    user.auth.loginAttempts = (user.auth.loginAttempts || 0) + 1;
    await user.save();
    throw new AuthError("Invalid email or password");
  }

  user.auth.lastLogin = new Date();
  user.auth.loginAttempts = 0;
  await user.save();

  return sanitize(user);
};

const logout = (session) =>
  new Promise((resolve, reject) => {
    if (!session) return resolve();
    session.destroy((err) => {
      if (err) return reject(err);
      resolve();
    });
  });

const getMe = async (userId) => {
  if (!userId) throw new ValidationError("userId is required");

  // Admin environment bypass
  if (userId === "ADMIN") {
    return {
      basicInfo: {
        userId: "ADMIN",
        fullName: "Viramah Admin",
        email: process.env.ADMIN_EMAIL || "admin@viramah.com",
      },
      role: "admin",
      accountStatus: "active",
      onboarding: { currentStep: "completed" },
    };
  }

  // Accountant environment bypass
  if (userId === "ACCOUNTANT_SYSTEM") {
    return {
      basicInfo: {
        userId: "ACCOUNTANT_SYSTEM",
        fullName: "Viramah Accountant",
        email: process.env.ACCOUNTANT_EMAIL || "accountant@viramah.com",
      },
      role: "accountant",
      accountStatus: "active",
      onboarding: { currentStep: "completed" },
    };
  }

  let user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) {
    const SalesAgent = require("../models/SalesAgent");
    user = await SalesAgent.findOne({ "basicInfo.userId": userId });
  }
  if (!user) throw new NotFoundError("User not found");
  return sanitize(user);
};

const OTP_EXPIRY_MS = 15 * 60 * 1000;

const maskEmail = (email) => {
  const [local, domain] = email.split("@");
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(local.length - 2, 3))}@${domain}`;
};

const forgotPasswordSendOtp = async (email) => {
  const normalizedEmail = normalizeLoginIdentifier(email);
  const user = await findUserByIdentifier(normalizedEmail);
  if (!user) throw new NotFoundError("no account found with this email id signup first");

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);

  if (!user.verification) user.verification = {};
  user.verification.otp = otpHash;
  user.verification.otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
  user.verification.otpAttempts = 0;
  user.verification.otpVerified = false;
  await user.save();

  sendPasswordResetOtp(user, otp).catch(() => {});
  return { maskedEmail: maskEmail(normalizedEmail) };
};

const forgotPasswordVerifyOtp = async (email, otp) => {
  const normalizedEmail = normalizeLoginIdentifier(email);
  const user = await findUserByIdentifier(normalizedEmail);
  if (!user) throw new AuthError("Invalid or expired OTP");

  const v = user.verification;
  if (!v?.otp || !v?.otpExpiresAt) throw new AuthError("No OTP requested");
  if (new Date() > v.otpExpiresAt) throw new AuthError("OTP has expired");
  if ((v.otpAttempts || 0) >= 5) throw new AuthError("Too many attempts. Request a new OTP");

  const match = await bcrypt.compare(otp, v.otp);
  if (!match) {
    user.verification.otpAttempts = (v.otpAttempts || 0) + 1;
    await user.save();
    throw new AuthError("Invalid OTP");
  }

  user.verification.otpVerified = true;
  user.verification.otp = undefined;
  user.verification.otpExpiresAt = undefined;
  await user.save();
};

const resetPassword = async (email, newPassword) => {
  const normalizedEmail = normalizeLoginIdentifier(email);
  const user = await findUserByIdentifier(normalizedEmail);
  if (!user || !user.verification?.otpVerified) {
    throw new AuthError("OTP verification required before resetting password");
  }

  user.auth.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  user.verification.otpVerified = false;
  user.verification.otpAttempts = 0;
  await user.save();
};

module.exports = { register, login, logout, getMe, sanitize, forgotPasswordSendOtp, forgotPasswordVerifyOtp, resetPassword };
