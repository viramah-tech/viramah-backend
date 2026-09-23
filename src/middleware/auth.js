const { AuthError } = require("../utils/errors");
const User = require("../models/User");

const auth = async (req, res, next) => {
  try {
    // If cookie was stripped by mobile browser, restore session from Bearer token or x-session-id header
    if (!req.session?.userId) {
      const authHeader = req.headers.authorization;
      const token = (authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null) || req.headers["x-session-id"];
      if (token && req.sessionStore) {
        try {
          await new Promise((resolve) => {
            req.sessionStore.get(token, (err, sessionData) => {
              if (!err && sessionData && sessionData.userId) {
                req.session = Object.assign(req.session || {}, sessionData);
                req.sessionID = token;
              }
              resolve();
            });
          });
        } catch (sessionErr) {
          console.error("[AUTH_TOKEN_RESTORE_ERROR]", sessionErr);
        }
      }
    }

    if (!req.session || !req.session.userId) {
      throw new AuthError();
    }

    if (req.session.userId === "ADMIN") {
      req.user = {
        basicInfo: {
          userId: "ADMIN",
          fullName: "Viramah Admin",
          email: process.env.ADMIN_EMAIL || "admin@viramah.com",
        },
        role: "admin",
        accountStatus: "active",
        onboarding: { currentStep: "completed" },
      };
      return next();
    }

    if (req.session.userId === "ACCOUNTANT_SYSTEM") {
      req.user = {
        basicInfo: {
          userId: "ACCOUNTANT_SYSTEM",
          fullName: "Viramah Accountant",
          email: process.env.ACCOUNTANT_EMAIL || "accountant@viramah.com",
        },
        role: "accountant",
        accountStatus: "active",
        onboarding: { currentStep: "completed" },
      };
      return next();
    }

    if (req.session.userId === "HOSTEL_INCHARGE_SYSTEM") {
      req.user = {
        basicInfo: {
          userId: "HOSTEL_INCHARGE_SYSTEM",
          fullName: "Viramah Hostel Incharge",
          email: process.env.HOSTEL_INCHARGE_EMAIL || "incharge@viramah.com",
        },
        role: "hostel_incharge",
        accountStatus: "active",
        onboarding: { currentStep: "completed" },
      };
      return next();
    }

    let user = await User.findOne({ "basicInfo.userId": req.session.userId });
    if (!user) {
      const SalesAgent = require("../models/SalesAgent");
      user = await SalesAgent.findOne({ "basicInfo.userId": req.session.userId });
    }
    if (!user) {
      throw new AuthError("User not found");
    }
    if (user.auth?.isBlocked) {
      throw new AuthError("Account is blocked");
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = auth;
