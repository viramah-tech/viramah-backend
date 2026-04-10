const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { buildOtpEmailHtml } = require('../templates/otpEmail');
const { sendEmail } = require('./email-service');

// ── Configuration ────────────────────────────────────────────────────────────
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_SECONDS = 60; // min time between resend requests

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a cryptographically-secure 6-digit OTP string. */
function generateOtp() {
  // crypto.randomInt is CSPRNG — no bias on modulo
  const num = crypto.randomInt(0, 10 ** OTP_LENGTH);
  return String(num).padStart(OTP_LENGTH, '0');
}

/** Hash OTP before storing (prevents DB-leak exposure). */
async function hashOtp(otp) {
  const salt = await bcrypt.genSalt(6); // lighter than password; OTP is short-lived
  return bcrypt.hash(otp, salt);
}

/** Compare plaintext OTP against stored hash. */
async function compareOtp(plainOtp, hashedOtp) {
  return bcrypt.compare(plainOtp, hashedOtp);
}

/** Mask an email: s*****r@gmail.com */
function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 5))}${local.slice(-1)}@${domain}`;
}

/** Mask a phone: ******1234 */
function maskPhone(phone) {
  if (!phone || phone.length < 4) return '******';
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}

// ── Email OTP ────────────────────────────────────────────────────────────────

/**
 * Send an email OTP to the user.
 * @param {import('mongoose').Document} user - Mongoose user document
 * @returns {{ success: boolean, maskedEmail: string, expiresIn: number }}
 */
async function sendEmailOtp(user) {
  if (!user.email) {
    const err = new Error('No email address on file');
    err.statusCode = 400;
    throw err;
  }

  if (user.emailVerified) {
    const err = new Error('Email is already verified');
    err.statusCode = 400;
    throw err;
  }

  // Cooldown check — prevent spam
  if (user.emailOtpExpiresAt) {
    const sentAt = new Date(user.emailOtpExpiresAt.getTime() - OTP_EXPIRY_MINUTES * 60 * 1000);
    const cooldownEnd = new Date(sentAt.getTime() + OTP_COOLDOWN_SECONDS * 1000);
    if (Date.now() < cooldownEnd.getTime()) {
      const waitSecs = Math.ceil((cooldownEnd.getTime() - Date.now()) / 1000);
      const err = new Error(`Please wait ${waitSecs} seconds before requesting a new code`);
      err.statusCode = 429;
      throw err;
    }
  }

  // Generate + hash + save
  const otp = generateOtp();
  const hashedOtp = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  user.emailOtp = hashedOtp;
  user.emailOtpExpiresAt = expiresAt;
  user.emailOtpAttempts = 0;
  await user.save();

  // Send email via emailService
  const firstName = (user.name || 'there').split(' ')[0];

  const html = buildOtpEmailHtml({
    firstName,
    otp,
    channel: 'email',
    expiryMinutes: OTP_EXPIRY_MINUTES,
  });

  try {
    const result = await sendEmail({
      to: user.email,
      subject: `${otp} — Your Viramah verification code`,
      html,
    });
    console.log(`[OTP] Email OTP sent to ${maskEmail(user.email)} (id=${result.id})`);
  } catch (error) {
    console.error('[OTP] Resend send error:', error);
    const err = new Error('Failed to send verification email. Please try again.');
    err.statusCode = 502;
    throw err;
  }

  return {
    success: true,
    maskedEmail: maskEmail(user.email),
    expiresIn: OTP_EXPIRY_MINUTES * 60,
  };
}

/**
 * Verify an email OTP code.
 * @param {import('mongoose').Document} user
 * @param {string} code - 6-digit code from user input
 * @returns {{ success: boolean }}
 */
async function verifyEmailOtp(user, code) {
  if (user.emailVerified) {
    return { success: true, alreadyVerified: true };
  }

  // Check if OTP exists
  if (!user.emailOtp || !user.emailOtpExpiresAt) {
    const err = new Error('No verification code was requested. Please send a new code.');
    err.statusCode = 400;
    throw err;
  }

  // Check expiry
  if (Date.now() > user.emailOtpExpiresAt.getTime()) {
    // Clear expired OTP
    user.emailOtp = null;
    user.emailOtpExpiresAt = null;
    user.emailOtpAttempts = 0;
    await user.save();
    const err = new Error('Verification code has expired. Please request a new one.');
    err.statusCode = 410;
    throw err;
  }

  // Check max attempts
  if (user.emailOtpAttempts >= OTP_MAX_ATTEMPTS) {
    // Invalidate OTP after too many attempts
    user.emailOtp = null;
    user.emailOtpExpiresAt = null;
    user.emailOtpAttempts = 0;
    await user.save();
    const err = new Error('Too many incorrect attempts. Please request a new code.');
    err.statusCode = 429;
    throw err;
  }

  // Compare
  const isValid = await compareOtp(code, user.emailOtp);
  if (!isValid) {
    user.emailOtpAttempts += 1;
    await user.save();
    const remaining = OTP_MAX_ATTEMPTS - user.emailOtpAttempts;
    const err = new Error(
      remaining > 0
        ? `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect attempts. Please request a new code.'
    );
    err.statusCode = 400;
    throw err;
  }

  // ✅ Success — mark verified and clear OTP fields
  user.emailVerified = true;
  user.emailVerifiedAt = new Date();
  user.emailOtp = null;
  user.emailOtpExpiresAt = null;
  user.emailOtpAttempts = 0;
  await user.save();

  return { success: true };
}

// ── Phone OTP ────────────────────────────────────────────────────────────────

/**
 * Send a phone OTP via SMS.
 * @param {import('mongoose').Document} user
 * @param {string} [phoneOverride] - Phone number to verify (allows updating phone)
 * @returns {{ success: boolean, maskedPhone: string, expiresIn: number }}
 */
async function sendPhoneOtp(user, phoneOverride) {
  const phone = phoneOverride || user.phone;
  if (!phone || phone.trim().length < 10) {
    const err = new Error('A valid phone number is required');
    err.statusCode = 400;
    throw err;
  }

  if (user.phoneVerified && !phoneOverride) {
    const err = new Error('Phone number is already verified');
    err.statusCode = 400;
    throw err;
  }

  // If a new phone number is provided, save it
  if (phoneOverride && phoneOverride !== user.phone) {
    user.phone = phoneOverride;
    user.phoneVerified = false;
    user.phoneVerifiedAt = null;
  }

  // Cooldown check
  if (user.phoneOtpExpiresAt) {
    const sentAt = new Date(user.phoneOtpExpiresAt.getTime() - OTP_EXPIRY_MINUTES * 60 * 1000);
    const cooldownEnd = new Date(sentAt.getTime() + OTP_COOLDOWN_SECONDS * 1000);
    if (Date.now() < cooldownEnd.getTime()) {
      const waitSecs = Math.ceil((cooldownEnd.getTime() - Date.now()) / 1000);
      const err = new Error(`Please wait ${waitSecs} seconds before requesting a new code`);
      err.statusCode = 429;
      throw err;
    }
  }

  // Generate + hash + save
  const otp = generateOtp();
  const hashedOtp = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  user.phoneOtp = hashedOtp;
  user.phoneOtpExpiresAt = expiresAt;
  user.phoneOtpAttempts = 0;
  await user.save();

  // ── Send SMS ───────────────────────────────────────────────────────────
  // Uses a pluggable approach: checks for configured SMS provider.
  // Currently supports console logging (dev) with ready-to-enable AWS SNS.
  await sendSms(phone, `${otp} is your Viramah verification code. Valid for ${OTP_EXPIRY_MINUTES} min. Do not share this code.`);

  console.log(`[OTP] Phone OTP sent to ${maskPhone(phone)}`);

  return {
    success: true,
    maskedPhone: maskPhone(phone),
    expiresIn: OTP_EXPIRY_MINUTES * 60,
  };
}

/**
 * Verify a phone OTP code.
 * @param {import('mongoose').Document} user
 * @param {string} code
 * @returns {{ success: boolean }}
 */
async function verifyPhoneOtp(user, code) {
  if (user.phoneVerified) {
    return { success: true, alreadyVerified: true };
  }

  if (!user.phoneOtp || !user.phoneOtpExpiresAt) {
    const err = new Error('No verification code was requested. Please send a new code.');
    err.statusCode = 400;
    throw err;
  }

  // Check expiry
  if (Date.now() > user.phoneOtpExpiresAt.getTime()) {
    user.phoneOtp = null;
    user.phoneOtpExpiresAt = null;
    user.phoneOtpAttempts = 0;
    await user.save();
    const err = new Error('Verification code has expired. Please request a new one.');
    err.statusCode = 410;
    throw err;
  }

  // Check max attempts
  if (user.phoneOtpAttempts >= OTP_MAX_ATTEMPTS) {
    user.phoneOtp = null;
    user.phoneOtpExpiresAt = null;
    user.phoneOtpAttempts = 0;
    await user.save();
    const err = new Error('Too many incorrect attempts. Please request a new code.');
    err.statusCode = 429;
    throw err;
  }

  // Compare
  const isValid = await compareOtp(code, user.phoneOtp);
  if (!isValid) {
    user.phoneOtpAttempts += 1;
    await user.save();
    const remaining = OTP_MAX_ATTEMPTS - user.phoneOtpAttempts;
    const err = new Error(
      remaining > 0
        ? `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect attempts. Please request a new code.'
    );
    err.statusCode = 400;
    throw err;
  }

  // ✅ Success
  user.phoneVerified = true;
  user.phoneVerifiedAt = new Date();
  user.phoneOtp = null;
  user.phoneOtpExpiresAt = null;
  user.phoneOtpAttempts = 0;
  await user.save();

  return { success: true };
}

// ── SMS Transport (MSG91) ────────────────────────────────────────────────────

/**
 * Send an SMS message via MSG91.
 * Falls back to console logging in development if MSG91 is not configured.
 *
 * @param {string} to - Phone number (E.164 or national format)
 * @param {string} message - SMS body (the OTP is extracted from it)
 */
async function sendSms(to, message) {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID;

  // ── MSG91 (if configured) ──────────────────────────────────────────────
  if (authKey && templateId) {
    try {
      // Normalize: extract 10-digit Indian mobile number
      let mobile = to.replace(/[\s\-()]/g, '');
      if (mobile.startsWith('+91')) mobile = mobile.slice(3);
      if (mobile.startsWith('91') && mobile.length > 10) mobile = mobile.slice(2);

      // Extract OTP from the message (first word is the OTP code)
      const otp = message.split(' ')[0];

      const response = await fetch(
        `https://control.msg91.com/api/v5/otp?template_id=${templateId}&mobile=91${mobile}&otp=${otp}`,
        {
          method: 'POST',
          headers: {
            'authkey': authKey,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (data.type === 'error') {
        console.error('[SMS] MSG91 send error:', data.message);
        const err = new Error('Failed to send SMS. Please try again.');
        err.statusCode = 502;
        throw err;
      }

      console.log(`[SMS] Sent via MSG91 to ${maskPhone(to)} — ${data.type}: ${data.message || 'OK'}`);
      return;
    } catch (msg91Err) {
      if (msg91Err.statusCode) throw msg91Err; // re-throw our own errors
      console.error('[SMS] MSG91 send failed:', msg91Err.message);
      if (process.env.NODE_ENV === 'production') {
        const err = new Error('Failed to send SMS. Please try again.');
        err.statusCode = 502;
        throw err;
      }
    }
  }

  // ── Fallback: Console log (development) ────────────────────────────────
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  📱 SMS OTP (Dev Mode — No SMS Provider)    ║');
  console.log(`║  To:      ${to.padEnd(34)} ║`);
  console.log(`║  Message: ${message.substring(0, 34).padEnd(34)} ║`);
  console.log('╚══════════════════════════════════════════════╝');
}

module.exports = {
  sendEmailOtp,
  verifyEmailOtp,
  sendPhoneOtp,
  verifyPhoneOtp,
  maskEmail,
  maskPhone,
};
