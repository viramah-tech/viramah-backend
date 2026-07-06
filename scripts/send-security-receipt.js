/**
 * One-off script: Send Security Deposit Receipt to Aayush Gupta
 * 
 * Usage:  node scripts/send-security-receipt.js
 * 
 * Uses the existing Resend configuration and payment receipt
 * email template already in the system.
 */

require("dotenv").config();

const { resend, fromEmail } = require("../src/config/resend");

// ── Receipt details ────────────────────────────────────────────
const RECIPIENT_NAME  = "Aayush Gupta";
const RECIPIENT_EMAIL = "guptaaayush692@gmail.com";
const AMOUNT          = 15000;
const PAYMENT_TYPE    = "Security Deposit";
const PAYMENT_DATE    = new Date().toLocaleDateString("en-IN", {
  day: "2-digit", month: "short", year: "numeric"
});
const RECEIPT_ID = `VRM-SEC-${Date.now().toString(36).toUpperCase()}`;

// ── Helpers ────────────────────────────────────────────────────
const formatCurrency = (amt) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amt || 0);

// ── Email HTML (matches the existing Viramah template style) ──
const html = `
<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F8FAFC; color: #1E293B;">
  <!-- Header Card -->
  <div style="background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center; border-bottom: 4px solid #C07A5A;">
    <div style="font-size: 28px; font-weight: 800; color: #FFFFFF; letter-spacing: 2px; margin: 0; text-transform: uppercase;">
      Viramah
    </div>
    <div style="font-size: 11px; font-weight: 600; color: #C07A5A; letter-spacing: 4px; margin-top: 6px; text-transform: uppercase;">
      Premium Student Living
    </div>
  </div>

  <!-- Body Content -->
  <div style="background-color: #FFFFFF; padding: 40px 32px; border-radius: 0 0 16px 16px; border: 1px solid #E2E8F0; border-top: none; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);">
    <h2 style="color: #0F172A; font-size: 22px; font-weight: 700; margin-top: 0; margin-bottom: 20px; border-left: 4px solid #C07A5A; padding-left: 12px; line-height: 1.2;">
      Payment Receipt — Security Deposit
    </h2>

    <p style="color: #334155; font-size: 15px; line-height: 1.6; margin-top: 0;">
      Dear <strong>${RECIPIENT_NAME}</strong>,
    </p>

    <p style="color: #334155; font-size: 15px; line-height: 1.6;">
      Thank you for your payment. This email confirms that your <strong>Security Deposit</strong> of <strong>${formatCurrency(AMOUNT)}</strong> has been received and recorded.
    </p>

    <!-- Success Badge -->
    <div style="background-color: #DCFCE7; border-left: 4px solid #16A34A; padding: 16px; border-radius: 4px; margin: 24px 0;">
      <p style="margin: 0; color: #15803D; font-weight: bold; font-size: 15px;">✓ Payment Received Successfully</p>
    </div>

    <!-- Receipt Details Table -->
    <h3 style="color: #0F172A; font-size: 16px; font-weight: 700; margin-bottom: 12px; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.5px;">
      Receipt Details
    </h3>

    <div style="background-color: #F8FAFC; border-radius: 8px; padding: 4px 0; margin-bottom: 24px; border: 1px solid #E2E8F0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #E2E8F0;">
          <td style="padding: 12px 16px; color: #64748B; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Receipt ID</td>
          <td style="padding: 12px 16px; color: #0F172A; font-size: 14px; font-weight: 700; text-align: right;">${RECEIPT_ID}</td>
        </tr>
        <tr style="border-bottom: 1px solid #E2E8F0;">
          <td style="padding: 12px 16px; color: #64748B; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Name</td>
          <td style="padding: 12px 16px; color: #0F172A; font-size: 14px; text-align: right;">${RECIPIENT_NAME}</td>
        </tr>
        <tr style="border-bottom: 1px solid #E2E8F0;">
          <td style="padding: 12px 16px; color: #64748B; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Email</td>
          <td style="padding: 12px 16px; color: #0F172A; font-size: 14px; text-align: right;">${RECIPIENT_EMAIL}</td>
        </tr>
        <tr style="border-bottom: 1px solid #E2E8F0;">
          <td style="padding: 12px 16px; color: #64748B; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Payment Type</td>
          <td style="padding: 12px 16px; color: #0F172A; font-size: 14px; text-align: right;">${PAYMENT_TYPE}</td>
        </tr>
        <tr style="border-bottom: 1px solid #E2E8F0;">
          <td style="padding: 12px 16px; color: #64748B; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Date</td>
          <td style="padding: 12px 16px; color: #0F172A; font-size: 14px; text-align: right;">${PAYMENT_DATE}</td>
        </tr>
        <tr>
          <td style="padding: 14px 16px; color: #64748B; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Amount</td>
          <td style="padding: 14px 16px; color: #0F172A; font-size: 18px; font-weight: 800; text-align: right;">${formatCurrency(AMOUNT)}</td>
        </tr>
      </table>
    </div>

    <p style="color: #64748B; font-size: 14px; line-height: 1.6;">
      Please retain this receipt for your records. The security deposit is fully refundable as per the terms and conditions of your stay agreement.
    </p>

    <p style="color: #64748B; font-size: 14px; line-height: 1.6; margin-top: 32px;">
      If you have any questions or require immediate support, please reach us at <a href="mailto:team@viramahstay.com" style="color: #C07A5A; text-decoration: none; font-weight: 600;">team@viramahstay.com</a> or call <a href="tel:+918679001662" style="color: #C07A5A; text-decoration: none; font-weight: 600;">+91 8679001662</a>.
    </p>

    <!-- Footer Info -->
    <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #F1F5F9; text-align: center;">
      <p style="color: #94A3B8; font-size: 12px; margin: 0 0 4px;">Viramah Accommodations Private Limited</p>
      <p style="color: #94A3B8; font-size: 11px; margin: 0 0 4px;">Krishna Valley, Vrindavan, Uttar Pradesh — India</p>
      <p style="color: #cbd5e1; font-size: 11px; margin: 0;">This is a transactional receipt. Please do not reply directly.</p>
    </div>
  </div>
</div>
`;

// ── Send ────────────────────────────────────────────────────────
(async () => {
  try {
    console.log("━".repeat(50));
    console.log("  Viramah — Sending Security Deposit Receipt");
    console.log("━".repeat(50));
    console.log(`  To:     ${RECIPIENT_EMAIL}`);
    console.log(`  Name:   ${RECIPIENT_NAME}`);
    console.log(`  Amount: ${formatCurrency(AMOUNT)}`);
    console.log(`  Type:   ${PAYMENT_TYPE}`);
    console.log(`  ID:     ${RECEIPT_ID}`);
    console.log(`  From:   ${fromEmail}`);
    console.log("━".repeat(50));

    const result = await resend.emails.send({
      from: fromEmail,
      to: RECIPIENT_EMAIL,
      subject: `Payment Receipt — Security Deposit of ${formatCurrency(AMOUNT)} | Viramah Stay`,
      html,
    });

    console.log("\n✅ Email sent successfully!");
    console.log("   Resend ID:", result.id || JSON.stringify(result));
    console.log("\n" + "━".repeat(50));
  } catch (err) {
    console.error("\n❌ Failed to send email:");
    console.error("  ", err.message || err);
    process.exit(1);
  }
})();
