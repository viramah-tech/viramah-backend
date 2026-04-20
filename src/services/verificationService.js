const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { resend, fromEmail } = require("../config/resend");
const { ValidationError, AppError, AuthError } = require("../utils/errors");
const { logAudit } = require("../utils/auditLogger");

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 3;

/**
 * Generate cryptographically secure 6-digit OTP
 * Uses crypto.randomInt for better randomness than Math.random()
 */
const generateOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

const sendOtp = async (user) => {
  if (!user.basicInfo?.email) {
    throw new ValidationError("User has no email on file");
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 8);

  user.verification.otp = otpHash;
  user.verification.otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  user.verification.otpAttempts = 0;
  await user.save();

  try {
    await resend.emails.send({
      from: fromEmail,
      to: user.basicInfo.email,
      subject: "Your Viramah verification code",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;">
          <h2 style="color:#1a1a1a;">Verify your email</h2>
          <p>Hi, use the code below to verify your email with Viramah.</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:6px;background:#f4f4f4;padding:16px;text-align:center;border-radius:8px;">${otp}</p>
          <p>This code expires in ${OTP_TTL_MINUTES} minutes. Do not share it with anyone.</p>
        </div>
      `,
    });
  } catch (err) {
    console.error("Resend send failed:", err);
    throw new AppError("Failed to send verification email", 502, "EMAIL_SEND_FAILED");
  }

  return { sent: true, email: user.basicInfo.email };
};

const verifyOtp = async (user, otp) => {
  if (!user.verification?.otp || !user.verification?.otpExpiresAt) {
    throw new ValidationError("No OTP pending. Request a new one.");
  }
  if (user.verification.otpExpiresAt < new Date()) {
    user.verification.otp = null;
    user.verification.otpExpiresAt = null;
    user.verification.otpAttempts = 0;
    await user.save();
    throw new ValidationError("OTP has expired. Request a new one.");
  }
  if ((user.verification.otpAttempts || 0) >= MAX_OTP_ATTEMPTS) {
    throw new AuthError("Too many OTP verification attempts. Request a new OTP.");
  }

  const match = await bcrypt.compare(otp, user.verification.otp);
  if (!match) {
    user.verification.otpAttempts = (user.verification.otpAttempts || 0) + 1;
    await user.save();
    
    logAudit("OTP_VERIFICATION_FAILED", {
      userId: user.basicInfo.userId,
      attempts: user.verification.otpAttempts,
      timestamp: new Date(),
    });
    
    throw new ValidationError("Invalid OTP");
  }

  user.verification.emailVerified = true;
  user.verification.otp = null;
  user.verification.otpExpiresAt = null;
  user.verification.otpAttempts = 0;
  user.onboarding.currentStep = "compliance"; // Advance to terms page after email verification
  await user.save();

  logAudit("OTP_VERIFIED", {
    userId: user.basicInfo.userId,
    email: user.basicInfo.email,
    timestamp: new Date(),
  });

  return { verified: true, nextStep: "compliance" };
};

module.exports = { sendOtp, verifyOtp };
