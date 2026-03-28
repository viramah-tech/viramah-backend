const User = require('../../models/User');
const { success, error } = require('../../utils/apiResponse');
const {
  sendEmailOtp,
  verifyEmailOtp,
  sendPhoneOtp,
  verifyPhoneOtp,
  maskEmail,
  maskPhone,
} = require('../../services/otpService');

// ── POST /api/public/verification/email/send ─────────────────────────────────
const sendEmailCode = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return error(res, 'User not found', 404);

    const result = await sendEmailOtp(user);

    return success(res, {
      maskedEmail: result.maskedEmail,
      expiresIn: result.expiresIn,
    }, `Verification code sent to ${result.maskedEmail}`);
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

// ── POST /api/public/verification/email/verify ──────────────────────────────
const verifyEmailCode = async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
      return error(res, 'A valid 6-digit verification code is required', 400);
    }

    const user = await User.findById(req.user._id);
    if (!user) return error(res, 'User not found', 404);

    const result = await verifyEmailOtp(user, otp.trim());

    if (result.alreadyVerified) {
      return success(res, { emailVerified: true, alreadyVerified: true }, 'Email is already verified');
    }

    return success(res, { emailVerified: true }, 'Email verified successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

// ── POST /api/public/verification/phone/send ─────────────────────────────────
const sendPhoneCode = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return error(res, 'User not found', 404);

    // Allow passing a phone number (to set/update before verifying)
    const result = await sendPhoneOtp(user, phone || undefined);

    return success(res, {
      maskedPhone: result.maskedPhone,
      expiresIn: result.expiresIn,
    }, `Verification code sent to ${result.maskedPhone}`);
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

// ── POST /api/public/verification/phone/verify ──────────────────────────────
const verifyPhoneCode = async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
      return error(res, 'A valid 6-digit verification code is required', 400);
    }

    const user = await User.findById(req.user._id);
    if (!user) return error(res, 'User not found', 404);

    const result = await verifyPhoneOtp(user, otp.trim());

    if (result.alreadyVerified) {
      return success(res, { phoneVerified: true, alreadyVerified: true }, 'Phone number is already verified');
    }

    return success(res, { phoneVerified: true }, 'Phone number verified successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

// ── GET /api/public/verification/status ──────────────────────────────────────
const getVerificationStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return error(res, 'User not found', 404);

    return success(res, {
      email: {
        address: maskEmail(user.email),
        verified: user.emailVerified || false,
        verifiedAt: user.emailVerifiedAt || null,
      },
      phone: {
        number: user.phone ? maskPhone(user.phone) : null,
        hasPhone: Boolean(user.phone && user.phone.trim()),
        verified: user.phoneVerified || false,
        verifiedAt: user.phoneVerifiedAt || null,
      },
      allVerified: (user.emailVerified || false) && (user.phoneVerified || false),
    }, 'Verification status retrieved');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  sendEmailCode,
  verifyEmailCode,
  sendPhoneCode,
  verifyPhoneCode,
  getVerificationStatus,
};
