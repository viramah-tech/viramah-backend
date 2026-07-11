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
  
  const dateSettled = formatDate(payment.reviewedAt);
  const dateSubmitted = formatDate(payment.uploadedAt || payment.createdAt);
  const paymentIdStr = payment.paymentId || String(payment._id || "");

  const categoryLabels = {
    room_rent: "Room Rent",
    security_deposit: "Security Deposit",
    registration_fee: "Registration Fee",
    mess: "Mess Fee",
    transport: "Transport Fee",
    booking: "Booking Deposit",
  };
  const catLabel = categoryLabels[payment.category] || categoryLabels[payment.paymentType] || "General Payment";

  const receiptHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payment Receipt - ${paymentIdStr}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2E2A26; background-color: #faf9f6; margin: 0; padding: 24px;">
  <table style="max-width: 600px; width: 100%; margin: 0 auto; border: 1px solid #E8E5DF; border-radius: 20px; padding: 36px; background-color: #ffffff; border-collapse: collapse; box-shadow: 0 4px 12px rgba(31,58,45,0.03);">
    <tr>
      <td>
        <!-- Header -->
        <table style="width: 100%; border-bottom: 2px solid #1F3A2D; padding-bottom: 20px; margin-bottom: 24px;">
          <tr>
            <td>
              <h1 style="font-family: Georgia, serif; color: #1F3A2D; margin: 0; font-size: 26px; font-weight: normal; line-height: 1.2;">VIRAMAH</h1>
              <p style="margin: 4px 0 0 0; font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #D8B56A; font-weight: bold;">Premium Student Living</p>
            </td>
            <td style="text-align: right; vertical-align: top;">
              <h2 style="margin: 0; color: #1F3A2D; font-size: 18px; font-weight: 600; letter-spacing: 0.5px;">PAYMENT RECEIPT</h2>
              <p style="margin: 4px 0 0 0; font-family: monospace; font-size: 11px; color: #7A7570;">Receipt No: REC-${paymentIdStr.slice(-6).toUpperCase()}</p>
            </td>
          </tr>
        </table>

        <!-- Banner Check -->
        <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 12px 16px; border-radius: 6px; margin-bottom: 24px;">
          <p style="margin:0; color:#2e7d32; font-weight:bold; font-size: 13px;">✓ Payment Approved & Settled</p>
        </div>

        <!-- Details Grid -->
        <table style="width: 100%; margin-bottom: 28px;">
          <tr>
            <td style="width: 50%; vertical-align: top; padding-right: 15px;">
              <h3 style="font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #7A7570; border-bottom: 1px solid #E8E5DF; padding-bottom: 6px; margin: 0 0 10px 0; font-weight: bold;">Paid By</h3>
              <p style="margin: 4px 0; font-size: 13px; font-weight: bold; color: #1F3A2D;">${fullName || "Student"}</p>
              <p style="margin: 2px 0; font-size: 12px; color: #7A7570;">Student ID: ${userId || "-"}</p>
              <p style="margin: 2px 0; font-size: 12px; color: #7A7570;">Email: ${email || "-"}</p>
            </td>
            <td style="width: 50%; vertical-align: top; padding-left: 15px;">
              <h3 style="font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #7A7570; border-bottom: 1px solid #E8E5DF; padding-bottom: 6px; margin: 0 0 10px 0; font-weight: bold;">Paid To</h3>
              <p style="margin: 4px 0; font-size: 13px; font-weight: bold; color: #1F3A2D;">VIRAMAH STAY</p>
              <p style="margin: 2px 0; font-size: 12px; color: #7A7570;">Premium Student Living</p>
              <p style="margin: 2px 0; font-size: 12px; color: #7A7570;">Near GLA University</p>
              <p style="margin: 2px 0; font-size: 12px; color: #7A7570;">Mathura, UP, India</p>
            </td>
          </tr>
        </table>

        <!-- Table Statement -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
          <thead>
            <tr style="background-color: #F6F4EF;">
              <th style="color: #1F3A2D; text-align: left; padding: 12px 14px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #E8E5DF; font-weight: bold;">Description</th>
              <th style="color: #1F3A2D; text-align: left; padding: 12px 14px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #E8E5DF; font-weight: bold;">UTR Reference</th>
              <th style="color: #1F3A2D; text-align: left; padding: 12px 14px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #E8E5DF; font-weight: bold;">Method</th>
              <th style="color: #1F3A2D; text-align: right; padding: 12px 14px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #E8E5DF; font-weight: bold;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 16px 14px; font-size: 13px; border-bottom: 1px solid #E8E5DF; color: #2E2A26;">${catLabel} Settlement</td>
              <td style="padding: 16px 14px; font-size: 12px; border-bottom: 1px solid #E8E5DF; color: #2E2A26; font-family: monospace; font-weight: bold;">${payment.transactionId || "-"}</td>
              <td style="padding: 16px 14px; font-size: 12px; border-bottom: 1px solid #E8E5DF; color: #2E2A26; text-transform: uppercase;">${payment.paymentMethod || payment.method || "-"}</td>
              <td style="padding: 16px 14px; font-size: 13px; border-bottom: 1px solid #E8E5DF; color: #1F3A2D; font-weight: bold; text-align: right;">${formatCurrency(payment.amounts?.totalAmount)}</td>
            </tr>
            <tr style="background-color: #fdfdfb;">
              <td colspan="3" style="text-align: right; font-weight: bold; font-size: 14px; padding: 16px 14px; border-top: 2px solid #1F3A2D; color: #2E2A26;">Total Paid:</td>
              <td style="text-align: right; font-weight: bold; font-size: 16px; padding: 16px 14px; border-top: 2px solid #1F3A2D; color: #1F3A2D;">${formatCurrency(payment.amounts?.totalAmount)}</td>
            </tr>
          </tbody>
        </table>

        <!-- Timeline / Sign-off -->
        <table style="width: 100%; margin-bottom: 24px;">
          <tr>
            <td style="width: 50%; vertical-align: bottom;">
              <h3 style="font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #7A7570; border-bottom: 1px solid #E8E5DF; padding-bottom: 6px; margin: 0 0 10px 0; font-weight: bold;">Timeline</h3>
              <p style="margin: 4px 0; font-size: 12px; color: #7A7570;">Submitted: <span style="font-weight: bold; color: #2E2A26;">${dateSubmitted}</span></p>
              <p style="margin: 4px 0; font-size: 12px; color: #7A7570;">Approved: <span style="font-weight: bold; color: #2E2A26;">${dateSettled}</span></p>
            </td>
            <td style="width: 50%; text-align: right; vertical-align: bottom; padding-bottom: 5px;">
              <div style="display: inline-block; border-top: 1px solid #2E2A26; width: 180px; padding-top: 6px; font-size: 11px; text-align: center; color: #7A7570;">
                Authorized Signatory
                <br><span style="font-weight: bold; color: #1F3A2D; font-family: Georgia, serif;">VIRAMAH ACCOUNTS</span>
              </div>
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <div style="text-align: center; margin-top: 32px; font-size: 11px; color: #7A7570; border-top: 1px dashed #E8E5DF; padding-top: 20px; line-height: 1.6;">
          This is a computer-generated document and does not require a physical signature.<br>
          Thank you for staying at Viramah Stay! For queries, contact support@viramahstay.com
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: `Payment Approved & Settled — REC-${paymentIdStr.slice(-6).toUpperCase()}`,
    html: receiptHtml,
    attachments: [
      {
        filename: `receipt-REC-${paymentIdStr.slice(-6).toUpperCase()}.html`,
        content: receiptHtml,
      }
    ]
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
