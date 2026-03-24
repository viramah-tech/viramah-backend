const User = require('../models/User');

const login = async (userId, password, role) => {
  // Check for roles not yet activated
  if (['manager', 'warden'].includes(role)) {
    const err = new Error('Role not yet activated');
    err.statusCode = 403;
    throw err;
  }

  // Only allow admin and accountant login
  if (!['admin', 'accountant'].includes(role)) {
    const err = new Error('Invalid role for admin login');
    err.statusCode = 400;
    throw err;
  }

  // Find user by userId and include password field
  const user = await User.findOne({ userId }).select('+password');

  if (!user) {
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    throw err;
  }

  // Check if role matches
  if (user.role !== role) {
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    throw err;
  }

  // Check if user is active
  if (user.status !== 'active') {
    const err = new Error('Account is not active. Contact administrator.');
    err.statusCode = 403;
    throw err;
  }

  // Check password
  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    throw err;
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  // Generate token
  const token = user.generateAuthToken();

  // Return user data without password
  const userData = user.toObject();
  delete userData.password;

  return { token, user: userData };
};

const getMe = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  return user;
};

module.exports = { login, getMe };
