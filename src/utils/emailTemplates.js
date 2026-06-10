const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);

const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const baseWrapper = (heading, contentHtml) => `
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
        ${heading}
      </h2>
      
      ${contentHtml}
      
      <p style="color: #64748B; font-size: 14px; line-height: 1.6; margin-top: 32px;">
        If you have any questions or require immediate support, please reply directly to this email or reach us at <a href="mailto:support@viramahstay.com" style="color: #C07A5A; text-decoration: none; font-weight: 600;">support@viramahstay.com</a>.
      </p>
      
      <!-- Footer Info -->
      <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #F1F5F9; text-align: center;">
        <p style="color: #94A3B8; font-size: 12px; margin: 0 0 4px;">Viramah Accommodations Private Limited</p>
        <p style="color: #cbd5e1; font-size: 11px; margin: 0;">This email was sent from an administrative portal. please do not reply directly.</p>
      </div>
    </div>
  </div>
`;

const compilePaymentTemplate = ({ user, heading, content }) => {
  const summary = user.paymentSummary || {};
  const grandTotal = summary.grandTotal || { total: 0, paid: 0, remaining: 0 };
  const roomRent = summary.roomRent || { total: 0, paid: 0, remaining: 0 };
  const deposit = summary.securityDeposit || { total: 0, paid: 0, remaining: 0 };
  const registration = summary.registrationFee || { total: 0, paid: 0, remaining: 0 };
  const deadlineDate = user.paymentDeadline?.expiresAt ? formatDate(user.paymentDeadline.expiresAt) : "N/A";

  const customMsgHtml = content ? `<p style="color: #334155; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">${content.replace(/\n/g, "<br/>")}</p>` : "";

  const items = [
    { label: "Registration Fee", total: registration.total, paid: registration.paid, remaining: registration.remaining },
    { label: "Security Deposit", total: deposit.total, paid: deposit.paid, remaining: deposit.remaining },
    { label: "Room Rent", total: roomRent.total, paid: roomRent.paid, remaining: roomRent.remaining }
  ].filter(i => i.total > 0);

  // Add mess and transport if they exist
  if (summary.messFee?.total > 0) {
    items.push({ label: "Mess Fee", total: summary.messFee.total, paid: summary.messFee.paid, remaining: summary.messFee.remaining });
  }
  if (summary.transportFee?.total > 0) {
    items.push({ label: "Transport Fee", total: summary.transportFee.total, paid: summary.transportFee.paid, remaining: summary.transportFee.remaining });
  }

  const tableRows = items.map(item => `
    <tr style="border-bottom: 1px solid #F1F5F9;">
      <td style="padding: 12px 0; color: #475569; font-weight: 500; font-size: 14px;">${item.label}</td>
      <td style="padding: 12px 8px; text-align: right; color: #475569; font-size: 14px;">${formatCurrency(item.total)}</td>
      <td style="padding: 12px 8px; text-align: right; color: #16A34A; font-weight: 600; font-size: 14px;">${formatCurrency(item.paid)}</td>
      <td style="padding: 12px 0; text-align: right; color: #DC2626; font-weight: 700; font-size: 14px;">${formatCurrency(item.remaining)}</td>
    </tr>
  `).join("");

  const bodyHtml = `
    <p style="color: #334155; font-size: 15px; line-height: 1.6; margin-top: 0;">
      Dear <strong>${user.basicInfo.fullName}</strong>,
    </p>
    
    ${customMsgHtml}
    
    <div style="background-color: #FFFbeb; border: 1px solid #FDE68A; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="margin: 0; color: #92400E; font-size: 14px; font-weight: 600; line-height: 1.5;">
        ⚠️ Payment Due Date: ${deadlineDate}
      </p>
    </div>

    <h3 style="color: #0F172A; font-size: 16px; font-weight: 700; margin-bottom: 12px; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.5px;">
      Outstanding Dues Statement
    </h3>
    
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <thead>
        <tr style="border-bottom: 2px solid #E2E8F0; text-align: left;">
          <th style="padding: 8px 0; color: #64748B; font-size: 12px; font-weight: 600; text-transform: uppercase;">Category</th>
          <th style="padding: 8px 8px; text-align: right; color: #64748B; font-size: 12px; font-weight: 600; text-transform: uppercase;">Total</th>
          <th style="padding: 8px 8px; text-align: right; color: #64748B; font-size: 12px; font-weight: 600; text-transform: uppercase;">Paid</th>
          <th style="padding: 8px 0; text-align: right; color: #64748B; font-size: 12px; font-weight: 600; text-transform: uppercase;">Remaining</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
        <tr style="border-top: 2px solid #E2E8F0; font-weight: bold; background-color: #F8FAFC;">
          <td style="padding: 16px 8px; color: #0F172A; font-size: 14px;">Grand Total</td>
          <td style="padding: 16px 8px; text-align: right; color: #0F172A; font-size: 14px;">${formatCurrency(grandTotal.total)}</td>
          <td style="padding: 16px 8px; text-align: right; color: #16A34A; font-size: 14px;">${formatCurrency(grandTotal.paid)}</td>
          <td style="padding: 16px 8px; text-align: right; color: #DC2626; font-size: 16px; font-weight: 800;">${formatCurrency(grandTotal.remaining)}</td>
        </tr>
      </tbody>
    </table>

    <div style="text-align: center; margin: 32px 0 24px;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/user-onboarding/payment-status" 
         style="background-color: #C07A5A; color: #FFFFFF; text-decoration: none; padding: 14px 28px; font-size: 15px; font-weight: 700; border-radius: 8px; display: inline-block; box-shadow: 0 4px 6px rgba(192, 122, 90, 0.2); transition: background-color 0.2s;">
        Submit Payment Proof
      </a>
    </div>
  `;

  return baseWrapper(heading, bodyHtml);
};

const compileDocumentTemplate = ({ user, heading, content }) => {
  const status = user.verification?.documentVerificationStatus || "pending";
  const reason = user.verification?.documentRejectionReason;
  const isApproved = status === "approved";
  const isRejected = status === "rejected";

  let badgeBg = "#FFFBEB";
  let badgeColor = "#D97706";
  let badgeText = "Pending Review";
  
  if (isApproved) {
    badgeBg = "#DCFCE7";
    badgeColor = "#15803D";
    badgeText = "Approved";
  } else if (isRejected) {
    badgeBg = "#FEE2E2";
    badgeColor = "#B91C1C";
    badgeText = "Action Required (Rejected)";
  }

  const customMsgHtml = content ? `<p style="color: #334155; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">${content.replace(/\n/g, "<br/>")}</p>` : "";
  const reasonHtml = isRejected && reason ? `
    <div style="background-color: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px; padding: 16px; margin: 24px 0;">
      <strong style="color: #991B1B; font-size: 14px; display: block; margin-bottom: 4px;">Rejection Reason:</strong>
      <p style="margin: 0; color: #B91C1C; font-size: 14px; line-height: 1.5;">${reason}</p>
    </div>
  ` : "";

  const bodyHtml = `
    <p style="color: #334155; font-size: 15px; line-height: 1.6; margin-top: 0;">
      Dear <strong>${user.basicInfo.fullName}</strong>,
    </p>
    
    ${customMsgHtml}
    
    <div style="margin: 24px 0 32px; text-align: center;">
      <span style="background-color: ${badgeBg}; color: ${badgeColor}; padding: 8px 18px; font-weight: 700; font-size: 13px; text-transform: uppercase; border-radius: 9999px; letter-spacing: 1px; display: inline-block;">
        Status: ${badgeText}
      </span>
    </div>

    ${reasonHtml}

    <p style="color: #334155; font-size: 15px; line-height: 1.6;">
      Please ensure all your onboarding documents (ID Proofs, Photos, Guardian ID proofs) are correctly uploaded.
    </p>

    <div style="text-align: center; margin: 32px 0 24px;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/user-onboarding" 
         style="background-color: #1E293B; color: #FFFFFF; text-decoration: none; padding: 14px 28px; font-size: 15px; font-weight: 700; border-radius: 8px; display: inline-block; transition: background-color 0.2s;">
        Access Onboarding Portal
      </a>
    </div>
  `;

  return baseWrapper(heading, bodyHtml);
};

const compileCustomTemplate = ({ user, heading, content }) => {
  const bodyHtml = `
    <p style="color: #334155; font-size: 15px; line-height: 1.6; margin-top: 0;">
      Dear <strong>${user.basicInfo.fullName}</strong>,
    </p>
    
    <div style="color: #334155; font-size: 15px; line-height: 1.6;">
      ${content.replace(/\n/g, "<br/>")}
    </div>
  `;
  return baseWrapper(heading, bodyHtml);
};

module.exports = {
  compilePaymentTemplate,
  compileDocumentTemplate,
  compileCustomTemplate,
};
