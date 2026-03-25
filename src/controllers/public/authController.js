const User = require('../../models/User');
const { success, error } = require('../../utils/apiResponse');

/**
 * POST /api/public/auth/register
 * Register a new resident account
 */
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return error(res, 'An account with this email already exists', 409);
    }

    // Auto-generate userId (e.g., RES000001)
    const count = await User.countDocuments();
    const userId = `RES${String(count + 1).padStart(6, '0')}`;

    const user = await User.create({
      userId,
      name,
      email: email.toLowerCase(),
      password,
      role: 'user',
      status: 'active',
      onboardingStatus: 'pending',
    });

    const token = user.generateAuthToken();

    // Set token in cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };
    res.cookie('token', token, cookieOptions);

    const userData = user.toObject();
    delete userData.password;
    userData.roomType = '';
    userData.selectedRoomType = '';

    return success(
      res,
      { token, user: userData },
      'Registration successful',
      201
    );
  } catch (err) {
    if (err.code === 11000) {
      return error(res, 'An account with this email already exists', 409);
    }
    next(err);
  }
};

/**
 * POST /api/public/auth/login
 * Login for residents
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase(), role: 'user' })
      .select('+password')
      .populate('roomTypeId', 'name');

    if (!user) {
      return error(res, 'Invalid email or password', 401);
    }

    if (user.status !== 'active') {
      return error(res, 'Account is not active. Contact administrator.', 403);
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return error(res, 'Invalid email or password', 401);
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    const token = user.generateAuthToken();

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
    res.cookie('token', token, cookieOptions);

    const userData = user.toObject();
    delete userData.password;
    userData.roomType = userData.roomTypeId ? userData.roomTypeId.name : '';
    userData.selectedRoomType = userData.roomTypeId ? userData.roomTypeId.name : '';

    return success(res, { token, user: userData }, 'Login successful');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/public/auth/logout
 */
const logout = async (req, res) => {
  res.cookie('token', '', { httpOnly: true, expires: new Date(0) });
  return success(res, null, 'Logged out successfully');
};

/**
 * GET /api/public/auth/me
 * Get current resident profile (requires auth)
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('roomTypeId', 'name');
    if (!user) {
      return error(res, 'User not found', 404);
    }
    const userData = user.toObject();
    userData.roomType = userData.roomTypeId ? userData.roomTypeId.name : '';
    userData.selectedRoomType = userData.roomTypeId ? userData.roomTypeId.name : '';
    return success(res, userData, 'Profile fetched successfully');
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, logout, getMe };
