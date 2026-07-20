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

const sendWhatsappGroupInviteEmail = async (user) => {
  const { email, fullName } = user.basicInfo;
  const firstName = fullName ? fullName.split(" ")[0] : "there";

  const inviteHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2E2A26; background-color: #FAF8F5; margin: 0; padding: 32px 16px;">
      <table style="max-width: 600px; width: 100%; margin: 0 auto; border: 1px solid #E8E5DF; border-radius: 24px; padding: 40px; background-color: #ffffff; border-collapse: collapse; box-shadow: 0 10px 30px rgba(31,58,45,0.05);">
        <tr>
          <td>
            <!-- Logo and Header -->
            <table style="width: 100%; text-align: center; margin-bottom: 32px;">
              <tr>
                <td>
                  <div style="display: inline-block; padding: 12px; background-color: #1F3A2D; border-radius: 50%; border: 2px solid #D8B56A; margin-bottom: 16px;">
                    <img src="https://viramahstay.com/logo.png" width="80" height="80" alt="Viramah Logo" style="display: block; border: 0;" />
                  </div>
                  <h1 style="font-family: Georgia, serif; color: #1F3A2D; margin: 0; font-size: 28px; font-weight: normal; letter-spacing: 1px; line-height: 1.2;">VIRAMAH</h1>
                  <p style="margin: 6px 0 0 0; font-size: 10px; text-transform: uppercase; letter-spacing: 3px; color: #D8B56A; font-weight: bold;">Premium Student Living</p>
                  <div style="width: 60px; height: 2px; background-color: #D8B56A; margin: 20px auto 0 auto;"></div>
                </td>
              </tr>
            </table>

            <!-- Greeting -->
            <div style="margin-bottom: 28px;">
              <p style="font-size: 16px; line-height: 1.6; color: #1F3A2D; font-weight: 600; margin: 0 0 16px 0;">Dear ${fullName || "there"},</p>
              <p style="font-size: 14px; line-height: 1.6; color: #4A4642; margin: 0 0 16px 0;">
                A warm welcome to <strong>Viramah Stay</strong>! We are absolutely thrilled to have you join our vibrant community.
              </p>
              <p style="font-size: 14px; line-height: 1.6; color: #4A4642; margin: 0 0 16px 0;">
                To ensure you stay connected with your fellow residents, receive real-time announcements from management, and never miss out on community activities and events, we invite you to join our official <strong>Resident WhatsApp Group</strong>.
              </p>
            </div>

            <!-- Call to Action (CTA) -->
            <div style="text-align: center; margin: 36px 0; background-color: #FAF8F5; border-radius: 16px; padding: 24px; border: 1px solid #E8E5DF;">
              <p style="margin: 0 0 16px 0; font-size: 13px; color: #7A7570; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Join with a single click</p>
              <a href="https://chat.whatsapp.com/EDvO9xiqN6H06ZzZJm8qQv" target="_blank" style="background-color: #1F3A2D; color: #ffffff; text-decoration: none; padding: 14px 32px; font-size: 15px; font-weight: bold; border-radius: 8px; border: 1.5px solid #D8B56A; display: inline-block; box-shadow: 0 4px 12px rgba(31,58,45,0.2);">
                Join Official WhatsApp Group
              </a>
              <p style="margin: 16px 0 0 0; font-size: 12px; color: #7A7570;">
                Or copy this link: <a href="https://chat.whatsapp.com/EDvO9xiqN6H06ZzZJm8qQv" style="color: #1F3A2D; text-decoration: underline; font-weight: 500;">https://chat.whatsapp.com/EDvO9xiqN6H06ZzZJm8qQv</a>
              </p>
            </div>

            <!-- Community Guidelines / Card -->
            <div style="border: 1px solid #E8E5DF; border-radius: 16px; padding: 24px; margin-bottom: 32px; background-color: #ffffff;">
              <table style="width: 100%;">
                <tr>
                  <td style="vertical-align: middle; width: 28px; padding-bottom: 12px;">
                    <span style="font-size: 20px;">📢</span>
                  </td>
                  <td style="padding-bottom: 12px; padding-left: 10px;">
                    <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: #1F3A2D; margin: 0; font-weight: bold;">Group Rules & Guidelines</h3>
                  </td>
                </tr>
              </table>
              <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #4A4642; line-height: 1.6;">
                <li style="margin-bottom: 8px;"><strong>Official Announcements:</strong> Stay updated on daily mess menus, facility announcements, and activities.</li>
                <li style="margin-bottom: 8px;"><strong>Community Discussions:</strong> A space to network and connect with peers within the Krishna Valley community.</li>
                <li style="margin-bottom: 8px;"><strong>Helpdesk Support:</strong> For direct complaints or maintenance requests, please write to us at support rather than posting in the chat.</li>
              </ul>
            </div>

            <!-- Next Steps / Sequence -->
            <h3 style="font-size: 12px; color: #1F3A2D; font-weight: bold; margin: 0 0 20px 0; text-transform: uppercase; letter-spacing: 1.5px;">Quick Onboarding Steps</h3>
            <table style="width: 100%; margin-bottom: 36px; border-collapse: collapse;">
              <tr>
                <td style="width: 36px; vertical-align: top; font-family: Georgia, serif; font-size: 22px; color: #D8B56A; font-weight: bold; padding-bottom: 20px;">01</td>
                <td style="vertical-align: top; font-size: 13px; color: #4A4642; padding-left: 16px; padding-bottom: 20px; line-height: 1.6;">
                  <strong>Join Group:</strong> Request to join using the link above and wait for approval.
                </td>
              </tr>
              <tr>
                <td style="width: 36px; vertical-align: top; font-family: Georgia, serif; font-size: 22px; color: #D8B56A; font-weight: bold; padding-bottom: 20px;">02</td>
                <td style="vertical-align: top; font-size: 13px; color: #4A4642; padding-left: 16px; padding-bottom: 20px; line-height: 1.6;">
                  <strong>Introduce Yourself:</strong> Let the group know your name, block, and domain/room numbers.
                </td>
              </tr>
              <tr>
                <td style="width: 36px; vertical-align: top; font-family: Georgia, serif; font-size: 22px; color: #D8B56A; font-weight: bold;">03</td>
                <td style="vertical-align: top; font-size: 13px; color: #4A4642; padding-left: 16px; line-height: 1.6;">
                  <strong>Review Resources:</strong> Check the pinned messages for coordinator numbers and emergency contacts.
                </td>
              </tr>
            </table>

            <!-- Contact & Sign-off -->
            <table style="width: 100%; border-top: 1px solid #E8E5DF; padding-top: 24px; margin-bottom: 24px;">
              <tr>
                <td style="vertical-align: top; width: 50%;">
                  <p style="margin: 0; font-size: 12px; color: #7A7570;">Need assistance?</p>
                  <p style="margin: 4px 0 0 0; font-size: 13px; font-weight: bold;">
                    <a href="mailto:team@viramahstay.com" style="color: #1F3A2D; text-decoration: none;">team@viramahstay.com</a>
                  </p>
                </td>
                <td style="text-align: right; vertical-align: top; width: 50%;">
                  <div style="font-size: 11px; color: #7A7570; line-height: 1.5;">
                    Warm regards,<br>
                    <span style="font-weight: bold; color: #1F3A2D; font-family: Georgia, serif; font-size: 14px;">The Viramah Team</span>
                    <br>Krishna Valley, Vrindavan
                  </div>
                </td>
              </tr>
            </table>

            <!-- Footer -->
            <div style="text-align: center; margin-top: 36px; font-size: 11px; color: #7A7570; border-top: 1px dashed #E8E5DF; padding-top: 24px; line-height: 1.6;">
              This is an automated system email. Please do not reply directly to this message.<br>
              © 2026 Viramah Stay. All rights reserved.
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;

  await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: "Welcome to the Viramah Community! Join our Official WhatsApp Group ✦",
    html: inviteHtml,
  });
};

module.exports = {
  sendWelcomeEmail,
  sendPaymentReceiptEmail,
  sendPasswordResetOtp,
  sendWhatsappGroupInviteEmail,
};
