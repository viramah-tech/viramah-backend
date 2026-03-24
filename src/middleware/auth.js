const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { error } = require('../utils/apiResponse');

const protect = async (req, res, next) => {
  let token;

  // Check Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  // Check cookies
  else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return error(res, 'Not authorized, no token provided', 401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      return error(res, 'Not authorized, user not found', 401);
    }

    next();
  } catch (err) {
    return error(res, 'Not authorized, token invalid', 401);
  }
};

module.exports = { protect };
