const fs = require("fs");
const path = require("path");
const AuditLog = require("../models/AuditLog");
const User = require("../models/User");

/**
 * Log audit events for compliance and security
 * Saves to MongoDB and backs up to logs/audit.log
 */
const logAudit = async (eventType, data) => {
  try {
    // Resolve admin details dynamically from database
    const adminInfo = {
      userId: data.adminId || "system",
      fullName: "System",
      role: "system"
    };

    if (data.adminId && data.adminId !== "system") {
      const adminUser = await User.findOne({ "basicInfo.userId": data.adminId });
      if (adminUser) {
        adminInfo.fullName = adminUser.basicInfo?.fullName || adminUser.basicInfo?.email || data.adminId;
        adminInfo.role = adminUser.role;
      }
    }

    // Resolve target details if targetUserId exists
    const targetInfo = {};
    const tId = data.targetUserId || data.userId;
    if (tId) {
      const targetUser = await User.findOne({ "basicInfo.userId": tId });
      if (targetUser) {
        targetInfo.targetId = tId;
        targetInfo.targetName = targetUser.basicInfo?.fullName || targetUser.basicInfo?.email;
      } else {
        targetInfo.targetId = tId;
        targetInfo.targetName = "System Resource / Object";
      }
    }

    // Build changes payload
    let changes = data.changes;
    if (!changes && (data.amount || data.reason || data.paymentId || data.metadata)) {
      changes = {
        oldValue: undefined,
        newValue: {
          amount: data.amount,
          reason: data.reason,
          paymentId: data.paymentId,
          ...(data.metadata || {})
        },
        fields: Object.keys(data.metadata || {})
      };
    }

    const auditEntry = new AuditLog({
      timestamp: new Date(),
      eventType,
      action: data.action || eventType,
      performedBy: adminInfo,
      target: targetInfo.targetId ? targetInfo : undefined,
      changes,
      clientInfo: data.clientInfo || {
        ipAddress: "127.0.0.1",
        userAgent: "Viramah Admin Client"
      },
      status: data.status || "success",
      error: data.error
    });

    await auditEntry.save();

    // Development Console output
    if (process.env.NODE_ENV !== "production") {
      console.log(`[AUDIT DB] ${eventType} - ${data.action || ''}:`, adminInfo.fullName, "->", targetInfo.targetName || "System");
    }

    // Append to file backup as fallback
    const AUDIT_LOG_DIR = path.join(__dirname, "../../logs");
    if (!fs.existsSync(AUDIT_LOG_DIR)) {
      fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
    }
    const logFile = path.join(AUDIT_LOG_DIR, "audit.log");
    fs.appendFileSync(
      logFile,
      JSON.stringify({ timestamp: new Date().toISOString(), eventType, data }) + "\n",
      { encoding: "utf8" }
    );
  } catch (err) {
    console.error("[AUDIT LOGGER ERROR] Failed to write audit log:", err);
  }
};

/**
 * Log payment-related events with full context
 */
const logPaymentAudit = (action, userId, paymentId, amount, metadata = {}) => {
  logAudit("PAYMENT", {
    action: "PAYMENT_" + action.toUpperCase(),
    userId,
    paymentId,
    amount,
    adminId: metadata.adminId,
    reason: metadata.reason,
    changes: {
      oldValue: { status: "PENDING" },
      newValue: { status: action.toUpperCase(), amount, paymentId, reason: metadata.reason },
      fields: ["paymentStatus"]
    },
    metadata
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
    changes: metadata.changes || (metadata.updatedFields ? {
      newValue: metadata.updatedFields,
      fields: Object.keys(metadata.updatedFields)
    } : undefined),
    metadata
  });
};

/**
 * Log security events
 */
const logSecurityEvent = (eventType, userId, metadata = {}) => {
  logAudit("SECURITY", {
    action: "SECURITY_" + eventType.toUpperCase(),
    userId,
    adminId: metadata.adminId || userId,
    metadata
  });
};

module.exports = {
  logAudit,
  logPaymentAudit,
  logAdminAction,
  logSecurityEvent,
};
