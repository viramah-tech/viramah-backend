const { AuthError } = require("../utils/errors");
const User = require("../models/User");

const auth = async (req, res, next) => {
  try {
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

    const user = await User.findOne({ "basicInfo.userId": req.session.userId });
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
