'use strict';

const LOGO_URL = 'https://viramahstay.com/logo.png';

/**
 * @param {object} opts
 * @param {string} opts.firstName
 * @param {string} opts.otp - 6-digit OTP
 * @param {number} [opts.expiryMinutes=10]
 * @returns {string} HTML
 */
function buildPasswordResetOtpEmailHtml({ firstName = 'there', otp, expiryMinutes = 10 }) {
  const digits = otp.split('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:32px 0 48px;background-color:#ECEAE3;font-family:'Georgia','Times New Roman',serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ECEAE3;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background-color:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 8px 48px rgba(0,0,0,0.14),0 2px 12px rgba(0,0,0,0.08);">

  <tr><td style="background-color:#1F3A2D;padding:32px 40px 28px;text-align:center;">
    <img src="${LOGO_URL}" width="56" height="56" alt="Viramah logo" style="display:block;margin:0 auto 12px;" />
    <p style="color:#F6F4EF;font-size:22px;font-weight:400;letter-spacing:0.04em;margin:0 0 6px;font-family:'Georgia',serif;">Viramah stay.</p>
    <p style="color:#D8B56A;font-size:9px;text-transform:uppercase;letter-spacing:0.42em;margin:0;font-family:'Courier New',monospace;">Premium Student Living</p>
  </td></tr>
  <tr><td style="height:3px;background:linear-gradient(90deg,#1F3A2D,#D8B56A 35%,#c9a55a 65%,#1F3A2D);"></td></tr>

  <tr><td style="padding:36px 44px 32px;">
    <p style="font-size:17px;color:#1a1a1a;margin:0 0 14px;font-family:'Georgia',serif;">Dear ${firstName},</p>

    <p style="font-size:15px;line-height:1.72;color:#3a3a3a;margin:0 0 20px;font-family:'Georgia',serif;">
      We received a request to reset your password. Use the code below to proceed. This code is valid for <strong style="color:#1F3A2D;">${expiryMinutes} minutes</strong>.
    </p>

    <!-- OTP Digits -->
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;border-collapse:separate;">
    <tr>
      ${digits.map(d => `<td style="width:48px;height:56px;text-align:center;font-size:28px;font-weight:700;font-family:'Courier New',monospace;color:#1F3A2D;background:#F6F4EF;border:2px solid #D8B56A;border-radius:8px;letter-spacing:0;">${d}</td>`).join('<td style="width:8px;"></td>')}
    </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F6F4EF;border-left:4px solid #D8B56A;border-radius:2px;margin:0 0 24px;">
    <tr><td style="padding:16px 20px;">
      <p style="font-size:9px;text-transform:uppercase;letter-spacing:0.38em;font-family:'Courier New',monospace;font-weight:700;color:#D8B56A;margin:0 0 8px;">IMPORTANT</p>
      <p style="font-size:13px;line-height:1.65;color:#444;margin:0;font-family:'Georgia',serif;">
        If you did not request a password reset, please ignore this email. Your password will remain unchanged. Never share this code with anyone.
      </p>
    </td></tr>
    </table>

    <hr style="border:none;border-top:1px solid rgba(31,58,45,0.1);margin:24px 0;" />
    <p style="font-size:15px;color:#3a3a3a;margin:0 0 6px;font-family:'Georgia',serif;">Warmly,</p>
    <p style="font-size:15px;font-weight:700;color:#1F3A2D;margin:0 0 4px;font-family:'Georgia',serif;">The Viramah Team</p>
    <p style="font-size:13px;color:#888;margin:0;font-family:'Georgia',serif;">Krishna Valley, Vrindavan</p>
  </td></tr>

  <tr><td style="height:3px;background:linear-gradient(90deg,#1F3A2D,#D8B56A 35%,#c9a55a 65%,#1F3A2D);"></td></tr>

  <tr><td style="background-color:#1F3A2D;padding:28px 44px 36px;text-align:center;">
    <p style="color:#F6F4EF;font-size:17px;font-weight:400;letter-spacing:0.05em;margin:0 0 6px;font-family:'Georgia',serif;">Viramah stay.</p>
    <p style="color:rgba(246,244,239,0.45);font-size:11px;letter-spacing:0.04em;margin:0 0 14px;font-family:'Courier New',monospace;">Krishna Valley, Vrindavan, Uttar Pradesh &mdash; India</p>
    <p style="font-size:12px;margin:0 0 18px;font-family:'Courier New',monospace;">
      <a href="https://viramahstay.com" style="color:#D8B56A;text-decoration:none;">viramahstay.com</a>
      <span style="color:#D8B56A;padding:0 6px;">&middot;</span>
      <a href="mailto:team@viramahstay.com" style="color:#D8B56A;text-decoration:none;">team@viramahstay.com</a>
    </p>
    <p style="font-size:10px;color:rgba(246,244,239,0.28);font-family:'Courier New',monospace;line-height:1.6;margin:0;">
      This is a transactional email from Viramah Stay &mdash; not a marketing message.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = { buildPasswordResetOtpEmailHtml };
