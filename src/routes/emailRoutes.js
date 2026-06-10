const express = require("express");
const Joi = require("joi");
const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const EmailLog = require("../models/EmailLog");
const User = require("../models/User");
const { resend, fromEmail } = require("../config/resend");
const {
  compilePaymentTemplate,
  compileDocumentTemplate,
  compileCustomTemplate,
} = require("../utils/emailTemplates");
const { syncEmailStatuses } = require("../utils/emailWorker");

const router = express.Router();

// Apply authentication
router.use(auth);

// Authorize both admin and sales_member
router.use((req, res, next) => {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "sales_member")) {
    return res.status(403).json({
      success: false,
      error: { message: "Insufficient permissions to manage emails", code: "FORBIDDEN" },
    });
  }
  next();
});

const sendEmailSchema = Joi.object({
  userIds: Joi.array().items(Joi.string()).min(1).required(),
  type: Joi.string().valid("payment", "document", "custom").required(),
  subject: Joi.string().min(3).max(150).required(),
  heading: Joi.string().min(3).max(100).required(),
  content: Joi.string().allow("").default(""),
  scheduledAt: Joi.string().isoDate().allow(null, "").default(null),
});

router.post("/send", validate(sendEmailSchema), async (req, res, next) => {
  try {
    const { userIds, type, subject, heading, content, scheduledAt } = req.validatedBody;
    const adminUser = req.user;

    const users = await User.find({ "basicInfo.userId": { $in: userIds } });
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: "No matching users found" });
    }

    const logs = [];
    const isScheduled = !!scheduledAt;
    const scheduleTime = isScheduled ? new Date(scheduledAt) : null;

    if (isScheduled && scheduleTime <= new Date()) {
      return res.status(400).json({ success: false, message: "Scheduled time must be in the future" });
    }

    for (const user of users) {
      let bodyHtml = "";
      if (type === "payment") {
        bodyHtml = compilePaymentTemplate({ user, heading, content });
      } else if (type === "document") {
        bodyHtml = compileDocumentTemplate({ user, heading, content });
      } else {
        bodyHtml = compileCustomTemplate({ user, heading, content });
      }

      const emailLog = new EmailLog({
        recipient: {
          userId: user.basicInfo.userId,
          email: user.basicInfo.email,
          fullName: user.basicInfo.fullName,
        },
        subject,
        heading,
        body: bodyHtml,
        type,
        status: isScheduled ? "scheduled" : "sent",
        scheduledAt: scheduleTime,
        sentBy: {
          userId: adminUser.basicInfo.userId || adminUser._id.toString(),
          fullName: adminUser.basicInfo.fullName || "Admin",
          role: adminUser.role,
        },
      });

      if (!isScheduled) {
        try {
          const result = await resend.emails.send({
            from: fromEmail,
            to: user.basicInfo.email,
            subject,
            html: bodyHtml,
          });

          if (result && result.data && result.data.id) {
            emailLog.resendId = result.data.id;
            emailLog.sentAt = new Date();
          } else {
            emailLog.status = "failed";
            emailLog.error = "No message ID returned from Resend";
          }
        } catch (err) {
          emailLog.status = "failed";
          emailLog.error = err.message || String(err);
        }
      }

      await emailLog.save();
      logs.push(emailLog);
    }

    res.json({
      success: true,
      message: isScheduled
        ? `Successfully scheduled ${logs.length} email(s)`
        : `Successfully processed ${logs.length} email(s)`,
      data: logs,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/logs", async (req, res, next) => {
  try {
    const { status, type, search, page = 1, limit = 20 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (type) query.type = type;
    if (search) {
      const escapedSearch = search.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, "i");
      query.$or = [
        { "recipient.email": searchRegex },
        { "recipient.fullName": searchRegex },
        { "recipient.userId": searchRegex },
        { subject: searchRegex },
      ];
    }

    const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
    const [logs, total] = await Promise.all([
      EmailLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      EmailLog.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        logs,
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/logs/:id/cancel", async (req, res, next) => {
  try {
    const log = await EmailLog.findById(req.params.id);
    if (!log) {
      return res.status(404).json({ success: false, message: "Email log not found" });
    }
    if (log.status !== "scheduled") {
      return res.status(400).json({ success: false, message: "Only scheduled emails can be cancelled" });
    }

    log.status = "cancelled";
    await log.save();

    res.json({ success: true, message: "Scheduled email cancelled successfully", data: log });
  } catch (err) {
    next(err);
  }
});

router.post("/logs/sync", async (req, res, next) => {
  try {
    await syncEmailStatuses();
    res.json({ success: true, message: "Email delivery status synced with Resend" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
