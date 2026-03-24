const { error } = require('../utils/apiResponse');

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'Not authorized', 401);
    }

    if (!roles.includes(req.user.role)) {
      return error(
        res,
        `Role '${req.user.role}' is not authorized to access this resource`,
        403
      );
    }

    next();
  };
};

module.exports = { authorize };
