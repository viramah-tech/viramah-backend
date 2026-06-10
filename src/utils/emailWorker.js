const EmailLog = require("../models/EmailLog");
const { resend, fromEmail } = require("../config/resend");

const processScheduledEmails = async () => {
  try {
    const now = new Date();
    // Find scheduled emails where scheduledAt is in the past
    const pending = await EmailLog.find({
      status: "scheduled",
      scheduledAt: { $lte: now }
    });

    if (pending.length === 0) return;
    console.log(`[EMAIL WORKER] Processing ${pending.length} scheduled emails...`);

    for (const log of pending) {
      try {
        const result = await resend.emails.send({
          from: fromEmail,
          to: log.recipient.email,
          subject: log.subject,
          html: log.body
        });

        if (result && result.data && result.data.id) {
          log.status = "sent";
          log.resendId = result.data.id;
          log.sentAt = new Date();
          log.error = null;
        } else {
          log.status = "failed";
          log.error = "No message ID returned from Resend";
        }
      } catch (err) {
        console.error(`[EMAIL WORKER] Failed to send scheduled email to ${log.recipient.email}:`, err.message);
        log.status = "failed";
        log.error = err.message || String(err);
      }
      await log.save();
    }
  } catch (err) {
    console.error("[EMAIL WORKER] Error processing scheduled emails:", err);
  }
};

const syncEmailStatuses = async () => {
  try {
    // Find logs that are "sent" and have a resendId
    const sentLogs = await EmailLog.find({
      status: "sent",
      resendId: { $exists: true, $ne: null }
    }).limit(50); // limit to avoid API rate limits

    if (sentLogs.length === 0) return;
    console.log(`[EMAIL WORKER] Syncing statuses for ${sentLogs.length} sent emails...`);

    for (const log of sentLogs) {
      try {
        const details = await resend.emails.get(log.resendId);
        if (details && details.data) {
          const resendStatus = details.data.status;
          console.log(`[EMAIL WORKER] Resend ID ${log.resendId} status is: ${resendStatus}`);
          
          if (resendStatus === "delivered") {
            log.status = "delivered";
          } else if (resendStatus === "bounced" || resendStatus === "complained" || resendStatus === "failed") {
            log.status = "failed";
            log.error = `Resend status: ${resendStatus}`;
          }
          await log.save();
        }
      } catch (err) {
        // Ignore individual API failures, try again next run
        console.warn(`[EMAIL WORKER] Failed to sync status for ${log.resendId}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[EMAIL WORKER] Error syncing email statuses:", err);
  }
};

const startEmailWorker = () => {
  console.log("[EMAIL WORKER] Initializing background email worker...");
  
  // Run tasks immediately on startup (wrapped in short timeout to let DB connect first)
  setTimeout(() => {
    processScheduledEmails();
    syncEmailStatuses();
  }, 5000);

  // Run scheduled mail process every 60 seconds
  setInterval(processScheduledEmails, 60000);

  // Run status sync every 5 minutes (300000ms)
  setInterval(syncEmailStatuses, 300000);
};

module.exports = { startEmailWorker, processScheduledEmails, syncEmailStatuses };
