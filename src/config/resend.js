const { Resend } = require("resend");

let _resend = null;

const getResend = () => {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
};

// Lazy proxy so module can be required before env is populated.
const resend = {
  emails: {
    send: (...args) => getResend().emails.send(...args),
  },
};

const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@viramah.com";

module.exports = { resend, fromEmail };
