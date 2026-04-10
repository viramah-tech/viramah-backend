'use strict';

const { Resend } = require('resend');

// ── Resend client (lazy singleton) ───────────────────────────────────────────
let _resend = null;
function getResend() {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (key) {
      _resend = new Resend(key);
    }
  }
  return _resend;
}

const DEFAULT_FROM = 'Viramah Stay <team@viramahstay.com>';

/**
 * Send an email via Resend.
 *
 * @param {object} opts
 * @param {string|string[]} opts.to - Recipient email(s)
 * @param {string} opts.subject - Email subject line
 * @param {string} opts.html - HTML body
 * @param {Array<{filename: string, content: Buffer}>} [opts.attachments] - Optional file attachments
 * @param {string} [opts.from] - Override sender (defaults to team@viramahstay.com)
 * @returns {Promise<{id: string}>} Resend message ID
 */
async function sendEmail({ to, subject, html, attachments = [], from }) {
  const resend = getResend();
  const fromAddress = from || process.env.EMAIL_FROM || DEFAULT_FROM;
  
  // DEV FALLBACK: If there's no API key, securely log to console to prevent flow disruption.
  if (!resend) {
    console.log(`\n\x1b[36m==================================================`);
    console.log(`✉️  [MOCK EMAIL DISPATCHED] (No RESEND_API_KEY mapped)`);
    console.log(`==================================================`);
    console.log(`🎯 TO:      ${Array.isArray(to) ? to.join(', ') : to}`);
    console.log(`📌 SUBJECT: ${subject}`);
    console.log(`📄 CONTENT: \n${html.replace(/<[^>]*>?/gm, '').substring(0, 200)}...`); // Simple strip HTML text for dev readability
    console.log(`==================================================\x1b[0m\n`);
    
    return { id: 'dev_mock_id_' + Date.now() };
  }

  const payload = {
    from: fromAddress,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    headers: {
      'X-Mailer': 'Viramah-Transactional-v1',
    },
  };

  // Resend accepts attachments as [{filename, content (Buffer)}]
  if (attachments.length > 0) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
    }));
  }

  const result = await resend.emails.send(payload);

  if (result.error) {
    console.error('[EmailService] Resend error:', result.error);
    const err = new Error('Failed to send email. Please try again.');
    err.statusCode = 502;
    throw err;
  }

  console.log(`[EmailService] Email sent to ${Array.isArray(to) ? to.join(', ') : to} | subject="${subject}" | id=${result.data?.id}`);
  return { id: result.data?.id };
}

module.exports = { sendEmail };
