const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);

const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const baseWrapper = (heading, contentHtml) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .email-container {
        padding: 10px !important;
      }
      .email-body {
        padding: 28px 18px !important;
        border-radius: 12px !important;
      }
      .kpi-table td {
        display: block !important;
        width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        padding-bottom: 8px !important;
      }
      .kpi-card {
        padding: 10px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F5EBE6; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <div class="email-container" style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #F5EBE6; color: #22252A;">
    <!-- Branding Header -->
    <div style="background: linear-gradient(135deg, #22252A 0%, #111215 100%); padding: 36px 24px; border-radius: 16px 16px 0 0; text-align: center; border-bottom: 4px solid #C07A5A; box-shadow: 0 4px 15px rgba(0,0,0,0.15);">
      <img src="https://viramah-uploads.s3.ap-south-1.amazonaws.com/logo.png" alt="Viramah Logo" width="44" height="44" style="display: block; margin: 0 auto 12px; border-radius: 8px;" />
      <div style="font-size: 28px; font-weight: 800; color: #FFFFFF; letter-spacing: 4px; margin: 0; text-transform: uppercase; font-family: 'Outfit', 'Playfair Display', Georgia, serif;">
        Viramah
      </div>
      <div style="font-size: 10px; font-weight: 700; color: #C07A5A; letter-spacing: 5px; margin-top: 6px; text-transform: uppercase; font-family: monospace;">
        Premium Student Living
      </div>
    </div>
    
    <!-- Main Body Card -->
    <div class="email-body" style="background-color: #FFFFFF; padding: 40px 32px; border-radius: 0 0 16px 16px; border: 1px solid #E5D9D0; border-top: none; box-shadow: 0 4px 12px rgba(34, 37, 42, 0.03);">
      <h2 style="color: #22252A; font-size: 18px; font-weight: 800; margin-top: 0; margin-bottom: 24px; border-left: 4px solid #C07A5A; padding-left: 12px; line-height: 1.2; text-transform: uppercase; letter-spacing: 0.5px;">
        ${heading}
      </h2>
      
      ${contentHtml}
      
      <!-- Support Block -->
      <div style="margin-top: 36px; padding: 18px; background-color: #FDFBF7; border: 1px solid #E5D9D0; border-radius: 12px;">
        <p style="color: #64748B; font-size: 13px; line-height: 1.6; margin: 0; text-align: center;">
          Have questions or need assistance? Reach out to our administration desk at 
          <a href="mailto:support@viramahstay.com" style="color: #C07A5A; text-decoration: none; font-weight: 700;">support@viramahstay.com</a>.
        </p>
      </div>
      
      <!-- Footer Info -->
      <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #F1F5F9; text-align: center;">
        <p style="color: #94A3B8; font-size: 11px; font-weight: 600; margin: 0 0 4px;">Viramah Accommodations Private Limited</p>
        <p style="color: #CBD5E1; font-size: 9px; margin: 0; font-family: monospace;">This is an administrative email notification sent from the Viramah Management Portal. Please do not reply directly to this mail.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

const compilePaymentTemplate = ({ user, heading, content }) => {
  const summary = user.paymentSummary || {};
  const grandTotal = summary.grandTotal || { total: 0, paid: 0, remaining: 0 };
  const roomRent = summary.roomRent || { total: 0, paid: 0, remaining: 0 };
  const deposit = summary.securityDeposit || { total: 0, paid: 0, remaining: 0 };
  const registration = summary.registrationFee || { total: 0, paid: 0, remaining: 0 };
  const deadlineDate = "11 June";

  const customMsgHtml = content ? `<p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">${content.replace(/\n/g, "<br/>")}</p>` : "";

  const items = [
    { label: "Registration Fee", total: registration.total, paid: registration.paid, remaining: registration.remaining },
    { label: "Security Deposit", total: deposit.total, paid: deposit.paid, remaining: deposit.remaining },
    { label: "Room Rent", total: roomRent.total, paid: roomRent.paid, remaining: roomRent.remaining }
  ].filter(i => i.total > 0);

  // Add optional items if they have positive values
  if (summary.messFee?.total > 0) {
    items.push({ label: "Mess Fee", total: summary.messFee.total, paid: summary.messFee.paid, remaining: summary.messFee.remaining });
  }
  if (summary.transportFee?.total > 0) {
    items.push({ label: "Transport Fee", total: summary.transportFee.total, paid: summary.transportFee.paid, remaining: summary.transportFee.remaining });
  }
  if (summary.fines?.total > 0) {
    items.push({ label: "Fines & Penalties", total: summary.fines.total, paid: summary.fines.paid, remaining: summary.fines.remaining });
  }

  const cardRows = items.map(item => `
    <div style="padding: 12px 16px; border: 1px solid #E5D9D0; border-radius: 10px; margin-bottom: 10px; background-color: #FDFBF7; box-shadow: 0 2px 4px rgba(34, 37, 42, 0.01);">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="font-weight: 700; color: #22252A; font-size: 13px;">${item.label}</td>
          <td style="text-align: right; color: #A95A3C; font-weight: 700; font-size: 13px;">${formatCurrency(item.remaining)} Dues</td>
        </tr>
        <tr>
          <td style="font-size: 11px; color: #64748B; padding-top: 4px;">Total Billed: ${formatCurrency(item.total)} | Paid: ${formatCurrency(item.paid)}</td>
          <td style="text-align: right; font-size: 11px; color: #94A3B8; padding-top: 4px;">Status: ${item.remaining === 0 ? 'Fully Paid' : 'Pending'}</td>
        </tr>
      </table>
    </div>
  `).join("");

  const bodyHtml = `
    <p style="color: #22252A; font-size: 14px; line-height: 1.6; margin-top: 0;">
      Dear <strong>${user.basicInfo.fullName}</strong>,
    </p>
    
    ${customMsgHtml}
    
    <!-- Deadline Warning Banner -->
    <div style="background-color: #FFFBEB; border: 1px solid #FDE68A; border-radius: 10px; padding: 16px; margin-bottom: 24px;">
      <p style="margin: 0; color: #92400E; font-size: 13px; font-weight: 700; line-height: 1.5;">
        ⚠️ Payment Due Date: ${deadlineDate}
      </p>
      <p style="margin: 4px 0 0; color: #78350F; font-size: 12px; line-height: 1.4;">
        A fine of ₹100 per day will be added to the outstanding balance after the due date.
      </p>
    </div>

    <!-- KPI Dashboard Grid (Table implementation for wide support) -->
    <table class="kpi-table" style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <tr>
        <td style="width: 32%; padding-right: 6px;">
          <div class="kpi-card" style="background-color: #FDFBF7; border: 1px solid #E5D9D0; border-radius: 10px; padding: 12px; text-align: center;">
            <div style="font-size: 9px; color: #64748B; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Grand Total</div>
            <div style="font-size: 14px; font-weight: 800; color: #22252A; margin-top: 4px;">${formatCurrency(grandTotal.total)}</div>
          </div>
        </td>
        <td style="width: 32%; padding-right: 6px; padding-left: 6px;">
          <div class="kpi-card" style="background-color: #F0FDF4; border: 1px solid #DCFCE7; border-radius: 10px; padding: 12px; text-align: center;">
            <div style="font-size: 9px; color: #15803D; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Total Paid</div>
            <div style="font-size: 14px; font-weight: 800; color: #16A34A; margin-top: 4px;">${formatCurrency(grandTotal.paid)}</div>
          </div>
        </td>
        <td style="width: 32%; padding-left: 6px;">
          <div class="kpi-card" style="background-color: #FEF2F2; border: 1px solid #FEE2E2; border-radius: 10px; padding: 12px; text-align: center;">
            <div style="font-size: 9px; color: #991B1B; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Outstanding</div>
            <div style="font-size: 14px; font-weight: 800; color: #A95A3C; margin-top: 4px;">${formatCurrency(grandTotal.remaining)}</div>
          </div>
        </td>
      </tr>
    </table>

    <!-- Table Statement Header -->
    <h3 style="color: #22252A; font-size: 14px; font-weight: 800; margin-bottom: 12px; margin-top: 24px; text-transform: uppercase; letter-spacing: 0.5px;">
      Outstanding Dues Statement
    </h3>
    
    <!-- Stackable Card List -->
    <div style="margin-bottom: 24px;">
      ${cardRows}
      
      <!-- Grand Total Card -->
      <div style="padding: 16px; border-radius: 10px; background-color: #FDFBF7; border: 2px solid #C07A5A; margin-top: 14px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="font-weight: 800; color: #22252A; font-size: 14px;">Net Outstanding Dues</td>
            <td style="text-align: right; color: #A95A3C; font-weight: 800; font-size: 15px;">${formatCurrency(grandTotal.remaining)}</td>
          </tr>
          <tr>
            <td style="font-size: 11px; color: #64748B; padding-top: 4px;">Total Billed: ${formatCurrency(grandTotal.total)} | Total Paid: ${formatCurrency(grandTotal.paid)}</td>
            <td style="text-align: right; font-size: 11px; color: #A95A3C; font-weight: 700; padding-top: 4px;">Viramah Stay</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Call to Action -->
    <div style="text-align: center; margin: 32px 0 24px;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"}/login" 
         style="background-color: #C07A5A; color: #FFFFFF; text-decoration: none; padding: 12px 28px; font-size: 14px; font-weight: 700; border-radius: 8px; display: inline-block; box-shadow: 0 4px 10px rgba(192, 122, 90, 0.25); transition: background-color 0.2s;">
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

  const customMsgHtml = content ? `<p style="color: #475569; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">${content.replace(/\n/g, "<br/>")}</p>` : "";
  const reasonHtml = isRejected && reason ? `
    <div style="background-color: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 10px; padding: 16px; margin: 24px 0;">
      <strong style="color: #991B1B; font-size: 13px; display: block; margin-bottom: 4px;">Rejection Reason:</strong>
      <p style="margin: 0; color: #B91C1C; font-size: 13px; line-height: 1.5;">${reason}</p>
    </div>
  ` : "";

  const bodyHtml = `
    <p style="color: #22252A; font-size: 14px; line-height: 1.6; margin-top: 0;">
      Dear <strong>${user.basicInfo.fullName}</strong>,
    </p>
    
    ${customMsgHtml}
    
    <!-- Document Status Badge -->
    <div style="margin: 24px 0 28px; text-align: center;">
      <span style="background-color: ${badgeBg}; color: ${badgeColor}; padding: 8px 20px; font-weight: 700; font-size: 12px; text-transform: uppercase; border-radius: 9999px; letter-spacing: 1px; display: inline-block;">
        Status: ${badgeText}
      </span>
    </div>

    ${reasonHtml}

    <p style="color: #475569; font-size: 14px; line-height: 1.6;">
      Please ensure all your onboarding documents (Identity Proofs, Photos, Guardian IDs) are correctly uploaded.
    </p>

    <!-- Call to Action -->
    <div style="text-align: center; margin: 32px 0 24px;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"}/user-onboarding" 
         style="background-color: #22252A; color: #FFFFFF; text-decoration: none; padding: 12px 28px; font-size: 14px; font-weight: 700; border-radius: 8px; display: inline-block; transition: background-color 0.2s;">
        Access Onboarding Portal
      </a>
    </div>
  `;

  return baseWrapper(heading, bodyHtml);
};

const compileCustomTemplate = ({ user, heading, content }) => {
  const bodyHtml = `
    <p style="color: #22252A; font-size: 14px; line-height: 1.6; margin-top: 0;">
      Dear <strong>${user.basicInfo.fullName}</strong>,
    </p>
    
    <div style="color: #475569; font-size: 14px; line-height: 1.6;">
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
