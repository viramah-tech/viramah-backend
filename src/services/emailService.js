const { resend, fromEmail } = require("../config/resend");

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount || 0);

const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const sendWelcomeEmail = async (user, plainPassword) => {
  const { email, fullName, userId } = user.basicInfo;
  await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: "Welcome to Viramah — Your Account Details",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9f9f9;">
        <div style="background:#1a1a2e;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;">Viramah Stay</h1>
          <p style="color:#aaa;margin:8px 0 0;">Welcome to your new home</p>
        </div>
        <div style="background:#fff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
          <h2 style="color:#1a1a2e;margin-top:0;">Hello, ${fullName || "there"}!</h2>
          <p style="color:#555;">Your Viramah account has been created. Here are your login details — please keep them safe.</p>
          <div style="background:#f4f4f4;border-radius:6px;padding:20px;margin:24px 0;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 0;color:#888;font-size:14px;">User ID</td><td style="padding:8px 0;font-weight:bold;color:#1a1a2e;">${userId}</td></tr>
              <tr><td style="padding:8px 0;color:#888;font-size:14px;">Email</td><td style="padding:8px 0;font-weight:bold;color:#1a1a2e;">${email}</td></tr>
              <tr><td style="padding:8px 0;color:#888;font-size:14px;">Password</td><td style="padding:8px 0;font-weight:bold;color:#1a1a2e;">${plainPassword}</td></tr>
            </table>
          </div>
          <p style="color:#e74c3c;font-size:13px;"><strong>Security tip:</strong> Change your password after your first login.</p>
          <p style="color:#555;">Please complete your onboarding to secure your room. If you need help, contact us at <a href="mailto:support@viramahstay.com" style="color:#1a1a2e;">support@viramahstay.com</a>.</p>
          <p style="color:#aaa;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">Viramah Stay · This is an automated message, please do not reply.</p>
        </div>
      </div>
    `,
  });
};

const sendPaymentReceiptEmail = async (user, payment) => {
  const { email, fullName, userId } = user.basicInfo;
  const breakdown = payment.breakdown || {};

  const breakdownRows = [
    ["Room Rent", breakdown.roomRent],
    ["Security Deposit", breakdown.securityDeposit],
    ["Mess Fee", breakdown.messFee],
    ["Transport Fee", breakdown.transportFee],
    ["Registration Fee", breakdown.registrationFee],
  ]
    .filter(([, val]) => val && val > 0)
    .map(
      ([label, val]) =>
        `<tr><td style="padding:8px 12px;color:#555;border-bottom:1px solid #f0f0f0;">${label}</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #f0f0f0;">${formatCurrency(val)}</td></tr>`
    )
    .join("");

  await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: `Payment Receipt — ${formatCurrency(payment.amounts?.totalAmount)} Approved`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9f9f9;">
        <div style="background:#1a1a2e;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;">Viramah Stay</h1>
          <p style="color:#aaa;margin:8px 0 0;">Payment Receipt</p>
        </div>
        <div style="background:#fff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
          <div style="background:#e8f5e9;border-left:4px solid #4caf50;padding:16px;border-radius:4px;margin-bottom:24px;">
            <p style="margin:0;color:#2e7d32;font-weight:bold;">✓ Payment Approved</p>
          </div>
          <h2 style="color:#1a1a2e;margin-top:0;">Hello, ${fullName || "there"}!</h2>
          <p style="color:#555;">Your payment of <strong>${formatCurrency(payment.amounts?.totalAmount)}</strong> has been approved.</p>
          <div style="background:#f9f9f9;border-radius:6px;padding:16px;margin:24px 0;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 12px;color:#888;font-size:13px;border-bottom:1px solid #f0f0f0;">Receipt ID</td><td style="padding:8px 12px;font-weight:bold;font-size:13px;border-bottom:1px solid #f0f0f0;">${payment.paymentId}</td></tr>
              <tr><td style="padding:8px 12px;color:#888;font-size:13px;border-bottom:1px solid #f0f0f0;">Student ID</td><td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f0f0f0;">${userId}</td></tr>
              <tr><td style="padding:8px 12px;color:#888;font-size:13px;border-bottom:1px solid #f0f0f0;">Payment Type</td><td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f0f0f0;text-transform:capitalize;">${payment.paymentType?.replace(/_/g, " ") || "—"}</td></tr>
              <tr><td style="padding:8px 12px;color:#888;font-size:13px;border-bottom:1px solid #f0f0f0;">Method</td><td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f0f0f0;text-transform:uppercase;">${payment.paymentMethod || "—"}</td></tr>
              <tr><td style="padding:8px 12px;color:#888;font-size:13px;border-bottom:1px solid #f0f0f0;">Date Approved</td><td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #f0f0f0;">${formatDate(payment.reviewedAt)}</td></tr>
              <tr><td style="padding:8px 12px;color:#888;font-size:13px;">Total Amount</td><td style="padding:8px 12px;font-weight:bold;font-size:15px;color:#1a1a2e;">${formatCurrency(payment.amounts?.totalAmount)}</td></tr>
            </table>
          </div>
          ${
            breakdownRows
              ? `<h3 style="color:#1a1a2e;font-size:15px;">Allocation Breakdown</h3>
                 <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:6px;">${breakdownRows}</table>`
              : ""
          }
          <p style="color:#555;margin-top:24px;">Keep this receipt for your records. For queries contact <a href="mailto:support@viramahstay.com" style="color:#1a1a2e;">support@viramahstay.com</a>.</p>
          <p style="color:#aaa;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">Viramah Stay · This is an automated message, please do not reply.</p>
        </div>
      </div>
    `,
  });
};

const sendPasswordResetOtp = async (user, otp) => {
  const { email, fullName } = user.basicInfo;
  await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: "Viramah — Password Reset OTP",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9f9f9;">
        <div style="background:#1a1a2e;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;">Viramah Stay</h1>
          <p style="color:#aaa;margin:8px 0 0;">Password Reset</p>
        </div>
        <div style="background:#fff;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
          <h2 style="color:#1a1a2e;margin-top:0;">Hello, ${fullName || "there"}!</h2>
          <p style="color:#555;">We received a request to reset your password. Use the OTP below — it expires in <strong>15 minutes</strong>.</p>
          <div style="text-align:center;margin:32px 0;">
            <div style="display:inline-block;background:#1a1a2e;color:#fff;font-size:36px;font-weight:bold;letter-spacing:12px;padding:16px 32px;border-radius:8px;">${otp}</div>
          </div>
          <p style="color:#888;font-size:13px;">If you did not request a password reset, ignore this email. Your password will remain unchanged.</p>
          <p style="color:#aaa;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">Viramah Stay · This is an automated message, please do not reply.</p>
        </div>
      </div>
    `,
  });
};

module.exports = { sendWelcomeEmail, sendPaymentReceiptEmail, sendPasswordResetOtp };
