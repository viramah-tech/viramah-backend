const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@viramah.com";

module.exports = { resend, fromEmail };
