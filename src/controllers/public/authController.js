const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../../models/User');
const { getPricingConfig } = require('../../services/pricing-service');
const { attachRoomTypeName } = require('../../utils/attachRoomType');
const { success, error } = require('../../utils/apiResponse');
const { sendEmail } = require('../../services/email-service');
const { buildWelcomeEmailHtml } = require('../../templates/welcomeEmail');
const { buildPasswordResetOtpEmailHtml } = require('../../templates/passwordResetOtpEmail');
const { buildPasswordChangedEmailHtml } = require('../../templates/passwordChangedEmail');

/**
 * POST /api/public/auth/register
 * Register a new resident account
 */
const register = async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return error(res, 'An account with this email address already exists. Please log in instead.', 409);
    }

    // Auto-generate userId with retry loop.
    // Uses the highest existing RES-prefixed userId (not countDocuments) so that
    // gaps created by deleted users never cause collisions.
    // MongoDB's unique index on userId is the final atomicity guard.
    const MAX_RETRIES = 5;
    let user;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Find the highest existing RES-prefixed userId
        const lastUser = await User.findOne({ userId: /^RES/ })
          .sort({ userId: -1 })
          .select('userId')
          .lean();
        const lastNum = lastUser
          ? parseInt(lastUser.userId.replace('RES', ''), 10)
          : 0;
        const userId = `RES${String(lastNum + 1 + attempt).padStart(6, '0')}`;

        user = await User.create({
          userId,
          name,
          email: email.toLowerCase(),
          phone: phone || '',
          password,
          role: 'user',
          status: 'active',
          onboardingStatus: 'pending',
        });
        break; // Success — exit the retry loop
      } catch (createErr) {
        // Retry on userId OR referralCode collisions (both are auto-generated)
        const collidedField =
          createErr.code === 11000 &&
          createErr.keyPattern &&
          (createErr.keyPattern.userId || createErr.keyPattern.referralCode);

        if (!collidedField || attempt === MAX_RETRIES - 1) {
          throw createErr; // Re-throw non-retryable errors or final attempt failure
        }
        // Auto-generated field collision — retry
      }
    }

    const token = user.generateAuthToken();

    // Send welcome email with credentials (non-blocking — don't fail registration if email fails)
    try {
      const firstName = (name || 'there').split(' ')[0];
      const html = buildWelcomeEmailHtml({
        firstName,
        userId: user.userId,
        email: user.email,
        password: password, // plain-text captured before Mongoose pre-save hook hashed it
      });
      await sendEmail({
        to: user.email,
        subject: 'Welcome to Viramah Student Living — Your Account Details',
        html,
      });
    } catch (emailErr) {
      console.error('[Register] Welcome email failed (non-fatal):', emailErr.message);
    }

    // Set token in cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };
    res.cookie('token', token, cookieOptions);

    const userData = user.toObject();
    delete userData.password;
    userData.roomType = '';
    userData.selectedRoomType = '';

    return success(
      res,
      { token, user: userData },
      'Registration successful',
      201
    );
  } catch (err) {
    if (err.code === 11000) {
      // Identify the conflicting field — use keyValue as fallback (more reliable
      // than keyPattern across MongoDB driver versions)
      const keyPatternObj = err.keyPattern || {};
      const keyValueObj = err.keyValue || {};
      const field = Object.keys(keyPatternObj)[0]
        || Object.keys(keyValueObj)[0]
        || 'unknown';

      if (field === 'email') {
        return error(
          res,
          'An account with this email address already exists. Please log in instead.',
          409
        );
      }

      // Any other duplicate key error (userId, referralCode, stale index) —
      // never blame the email for someone else's collision
      console.error('[Register] Unexpected duplicate key error:', {
        field,
        keyValue: keyValueObj,
        keyPattern: keyPatternObj,
        message: err.message,
      });
      return error(
        res,
        'A temporary conflict occurred. Please try again.',
        409
      );
    }
    next(err);
  }
};

// ── Account lockout config ─────────────────────────────────────────────────
const MAX_LOGIN_ATTEMPTS = 10;
const LOCK_DURATION_MS   = 15 * 60 * 1000; // 15 minutes

/**
 * POST /api/public/auth/login
 * Login for residents — with account lockout and security logging
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    const user = await User.findOne({ email: email.toLowerCase(), role: { $in: ['user', 'resident'] } })
      .select('+password')
      .populate('roomTypeId', 'name');

    if (!user) {
      console.warn(`[SECURITY] Failed login — unknown email: ${email.toLowerCase()} | IP: ${clientIp}`);
      return error(res, 'Invalid email or password', 401);
    }

    // ── Account lockout check ──────────────────────────────────────────────
    if (user.lockUntil && user.lockUntil > new Date()) {
      const remainingMs = user.lockUntil.getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      console.warn(`[SECURITY] Login blocked — account locked: ${email.toLowerCase()} | IP: ${clientIp} | unlocks in ${remainingMin}min`);
      return error(res, `Account is temporarily locked. Try again in ${remainingMin} minute${remainingMin === 1 ? '' : 's'}.`, 423);
    }

    if (user.status !== 'active') {
      return error(res, 'Account is not active. Contact administrator.', 403);
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      // Increment failed attempts
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      console.warn(`[SECURITY] Failed login — wrong password: ${email.toLowerCase()} | IP: ${clientIp} | attempt ${user.loginAttempts}/${MAX_LOGIN_ATTEMPTS}`);

      // Lock account if max attempts exceeded
      if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
        console.warn(`[SECURITY] Account LOCKED: ${email.toLowerCase()} | IP: ${clientIp} | locked for 15 minutes`);
      }
      await user.save();

      return error(res, 'Invalid email or password', 401);
    }

    // ── Successful login — reset lockout counters ──────────────────────────
    user.loginAttempts = 0;
    user.lockUntil = null;
    user.lastLogin = new Date();
    await user.save();

    const token = user.generateAuthToken();

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
    res.cookie('token', token, cookieOptions);

    const userData = user.toObject();
    delete userData.password;
    delete userData.loginAttempts;
    delete userData.lockUntil;
    attachRoomTypeName(userData);

    userData.agreements = {
      termsAccepted:          user.termsAccepted ?? false,
      termsAcceptedAt:        user.termsAcceptedAt ?? null,
      termsVersion:           user.termsVersion ?? null,
      privacyPolicyAccepted:  user.privacyPolicyAccepted ?? false,
      privacyPolicyAcceptedAt:user.privacyPolicyAcceptedAt ?? null,
      privacyPolicyVersion:   user.privacyPolicyVersion ?? null,
    };

    userData.verification = {
      emailVerified:          user.emailVerified ?? false,
      phoneVerified:          user.phoneVerified ?? false,
    };

    return success(res, { token, user: userData }, 'Login successful');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/public/auth/logout
 */
const logout = async (req, res) => {
  res.cookie('token', '', { httpOnly: true, expires: new Date(0) });
  return success(res, null, 'Logged out successfully');
};

/**
 * GET /api/public/auth/me
 * Get current resident profile (requires auth)
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('roomTypeId', 'name');
    if (!user) {
      return error(res, 'User not found', 404);
    }
    const userData = user.toObject();
    attachRoomTypeName(userData);

    // Agreements block — consumed by frontend route guard and profile page
    userData.agreements = {
      termsAccepted:          user.termsAccepted ?? false,
      termsAcceptedAt:        user.termsAcceptedAt ?? null,
      termsVersion:           user.termsVersion ?? null,
      privacyPolicyAccepted:  user.privacyPolicyAccepted ?? false,
      privacyPolicyAcceptedAt: user.privacyPolicyAcceptedAt ?? null,
      privacyPolicyVersion:   user.privacyPolicyVersion ?? null,
    };

    // TODO (Print/PDF): When a printable onboarding summary is built, inject an
    // "AGREEMENTS & CONSENTS" section here using userData.agreements.
    // Format:
    //   Terms & Conditions:  Accepted  (version: termsVersion, on: termsAcceptedAt, IP: acceptanceIp)
    //   Privacy Policy:      Accepted  (version: privacyPolicyVersion, on: privacyPolicyAcceptedAt)
    //   "This record confirms informed consent at time of onboarding."

    // Verification block — consumed by verify-contact page and route guards
    userData.verification = {
      emailVerified:   user.emailVerified ?? false,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      phoneVerified:   user.phoneVerified ?? false,
      phoneVerifiedAt: user.phoneVerifiedAt ?? null,
    };

    return success(res, userData, 'Profile fetched successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/public/auth/accept-terms
 * Records the user's explicit acceptance of Terms & Conditions + Privacy Policy.
 * Idempotent — if already accepted, returns { alreadyAccepted: true } with 200.
 */
const acceptTerms = async (req, res, next) => {
  try {
    const { termsVersion, privacyPolicyVersion } = req.body;

    if (!termsVersion || !privacyPolicyVersion) {
      return error(res, 'Both termsVersion and privacyPolicyVersion are required', 400);
    }

    // Load current versions from PricingConfig (Fix #15: not hardcoded)
    const cfg = await getPricingConfig();
    const CURRENT_TERMS_VERSION   = cfg.currentTermsVersion   || 'v1.0';
    const CURRENT_PRIVACY_VERSION = cfg.currentPrivacyVersion || 'v1.0';

    if (termsVersion !== CURRENT_TERMS_VERSION) {
      return error(res, `Invalid terms version. Expected "${CURRENT_TERMS_VERSION}"`, 400);
    }
    if (privacyPolicyVersion !== CURRENT_PRIVACY_VERSION) {
      return error(res, `Invalid privacy policy version. Expected "${CURRENT_PRIVACY_VERSION}"`, 400);
    }

    const user = await User.findById(req.user._id);
    if (!user) return error(res, 'User not found', 404);

    // Idempotent — already accepted
    if (user.termsAccepted === true && user.privacyPolicyAccepted === true) {
      return success(res, {
        alreadyAccepted:  true,
        acceptedAt:       user.termsAcceptedAt,
        termsVersion:     user.termsVersion,
        privacyPolicyVersion: user.privacyPolicyVersion,
      }, 'Already accepted');
    }

    const now = new Date();
    const ip  = req.ip || req.headers['x-forwarded-for'] || '';
    const ua  = req.headers['user-agent'] || '';

    user.termsAccepted           = true;
    user.termsAcceptedAt         = now;
    user.termsVersion            = termsVersion;
    user.privacyPolicyAccepted   = true;
    user.privacyPolicyAcceptedAt = now;
    user.privacyPolicyVersion    = privacyPolicyVersion;
    user.acceptanceIp            = ip;
    user.acceptanceUserAgent     = ua;

    await user.save();

    return success(res, {
      success:             true,
      acceptedAt:          now,
      termsVersion,
      privacyPolicyVersion,
    }, 'Terms accepted successfully');
  } catch (err) {
    next(err);
  }
};

// ── OTP config (matches otpService) ──────────────────────────────────────────
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_SECONDS = 60;

/**
 * POST /api/public/auth/forgot-password/send-otp
 * Check if email exists, send OTP for password reset
 */
const forgotPasswordSendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return error(res, 'No account found with this email address. Please register first.', 404);
    }

    // Cooldown check
    if (user.passwordResetOtpExpiresAt) {
      const sentAt = new Date(user.passwordResetOtpExpiresAt.getTime() - OTP_EXPIRY_MINUTES * 60 * 1000);
      const cooldownEnd = new Date(sentAt.getTime() + OTP_COOLDOWN_SECONDS * 1000);
      if (Date.now() < cooldownEnd.getTime()) {
        const waitSecs = Math.ceil((cooldownEnd.getTime() - Date.now()) / 1000);
        return error(res, `Please wait ${waitSecs} seconds before requesting a new code.`, 429);
      }
    }

    // Generate OTP
    const otp = String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
    const salt = await bcrypt.genSalt(6);
    const hashedOtp = await bcrypt.hash(otp, salt);

    user.passwordResetOtp = hashedOtp;
    user.passwordResetOtpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    user.passwordResetOtpAttempts = 0;
    user.passwordResetVerified = false;
    await user.save();

    // Send OTP email
    const firstName = (user.name || 'there').split(' ')[0];
    const html = buildPasswordResetOtpEmailHtml({ firstName, otp, expiryMinutes: OTP_EXPIRY_MINUTES });

    await sendEmail({
      to: user.email,
      subject: `${otp} — Password Reset Code | Viramah`,
      html,
    });

    // Mask email for response
    const [local, domain] = user.email.split('@');
    const maskedEmail = local.length <= 2
      ? `${local[0]}***@${domain}`
      : `${local[0]}${'*'.repeat(Math.min(local.length - 2, 5))}${local.slice(-1)}@${domain}`;

    return success(res, { maskedEmail, expiresIn: OTP_EXPIRY_MINUTES * 60 }, 'OTP sent to your registered email.');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/public/auth/forgot-password/verify-otp
 * Verify the OTP code
 */
const forgotPasswordVerifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return error(res, 'No account found with this email address.', 404);
    }

    if (!user.passwordResetOtp || !user.passwordResetOtpExpiresAt) {
      return error(res, 'No OTP was requested. Please request a new code.', 400);
    }

    // Check expiry
    if (Date.now() > user.passwordResetOtpExpiresAt.getTime()) {
      user.passwordResetOtp = null;
      user.passwordResetOtpExpiresAt = null;
      user.passwordResetOtpAttempts = 0;
      user.passwordResetVerified = false;
      await user.save();
      return error(res, 'Code has expired. Please request a new one.', 410);
    }

    // Check max attempts
    if (user.passwordResetOtpAttempts >= OTP_MAX_ATTEMPTS) {
      user.passwordResetOtp = null;
      user.passwordResetOtpExpiresAt = null;
      user.passwordResetOtpAttempts = 0;
      user.passwordResetVerified = false;
      await user.save();
      return error(res, 'Too many incorrect attempts. Please request a new code.', 429);
    }

    // Compare
    const isValid = await bcrypt.compare(otp, user.passwordResetOtp);
    if (!isValid) {
      user.passwordResetOtpAttempts += 1;
      await user.save();
      const remaining = OTP_MAX_ATTEMPTS - user.passwordResetOtpAttempts;
      return error(
        res,
        remaining > 0
          ? `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Too many incorrect attempts. Please request a new code.',
        400
      );
    }

    // OTP verified — mark as verified
    user.passwordResetVerified = true;
    user.passwordResetOtpAttempts = 0;
    await user.save();

    return success(res, { verified: true }, 'OTP verified successfully. You can now set a new password.');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/public/auth/forgot-password/reset
 * Set new password (requires OTP to have been verified)
 */
const forgotPasswordReset = async (req, res, next) => {
  try {
    const { email, newPassword } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return error(res, 'No account found with this email address.', 404);
    }

    if (!user.passwordResetVerified) {
      return error(res, 'OTP has not been verified. Please verify OTP first.', 403);
    }

    // Validate password
    if (!newPassword || newPassword.length < 8) {
      return error(res, 'Password must be at least 8 characters.', 400);
    }
    if (newPassword.toLowerCase() === user.email.toLowerCase()) {
      return error(res, 'Password must not be the same as your email.', 400);
    }
    if (newPassword.toLowerCase() === (user.name || '').trim().toLowerCase()) {
      return error(res, 'Password must not be the same as your name.', 400);
    }

    // Set new password (pre-save hook will hash it)
    user.password = newPassword;

    // Clear all password reset fields
    user.passwordResetOtp = null;
    user.passwordResetOtpExpiresAt = null;
    user.passwordResetOtpAttempts = 0;
    user.passwordResetVerified = false;

    await user.save();

    // Send password changed confirmation email (non-blocking)
    try {
      const firstName = (user.name || 'there').split(' ')[0];
      const html = buildPasswordChangedEmailHtml({ firstName });
      await sendEmail({
        to: user.email,
        subject: 'Password Changed Successfully — Viramah Student Living',
        html,
      });
    } catch (emailErr) {
      console.error('[ForgotPassword] Confirmation email failed (non-fatal):', emailErr.message);
    }

    return success(res, null, 'Password has been reset successfully. You can now log in with your new password.');
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, logout, getMe, acceptTerms, forgotPasswordSendOtp, forgotPasswordVerifyOtp, forgotPasswordReset };
