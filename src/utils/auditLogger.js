const fs = require("fs");
const path = require("path");

const AUDIT_LOG_DIR = path.join(__dirname, "../../logs");

// Ensure logs directory exists
if (!fs.existsSync(AUDIT_LOG_DIR)) {
  fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
}

/**
 * Log audit events for compliance and security
 * Logs are stored in logs/audit.log
 */
const logAudit = (eventType, data) => {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    eventType,
    data,
  };

  const logFile = path.join(AUDIT_LOG_DIR, "audit.log");
  fs.appendFileSync(
    logFile,
    JSON.stringify(entry) + "\n",
    { encoding: "utf8" }
  );

  // Also log critical events to console in development
  if (process.env.NODE_ENV !== "production" && 
      ["PAYMENT_APPROVED", "PAYMENT_REJECTED", "ADMIN_LOGIN", "ADMIN_ACTION"].includes(eventType)) {
    console.log(`[AUDIT] ${eventType}:`, data);
  }
};

/**
 * Log payment-related events with full context
 */
const logPaymentAudit = (action, userId, paymentId, amount, metadata = {}) => {
  logAudit("PAYMENT_" + action.toUpperCase(), {
    userId,
    paymentId,
    amount,
    adminId: metadata.adminId,
    reason: metadata.reason,
    timestamp: new Date(),
    ...metadata,
  });
};

/**
 * Log admin actions
 */
const logAdminAction = (action, adminId, targetUserId, metadata = {}) => {
  logAudit("ADMIN_ACTION", {
    action,
    adminId,
    targetUserId,
    timestamp: new Date(),
    ...metadata,
  });
};

/**
 * Log security events
 */
const logSecurityEvent = (eventType, userId, metadata = {}) => {
  logAudit("SECURITY_" + eventType.toUpperCase(), {
    userId,
    timestamp: new Date(),
    ...metadata,
  });
};

module.exports = {
  logAudit,
  logPaymentAudit,
  logAdminAction,
  logSecurityEvent,
};
