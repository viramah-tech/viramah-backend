const authService = require('../../services/auth-service');
const { success, error } = require('../../utils/apiResponse');

const login = async (req, res, next) => {
  try {
    const { userId, password, role } = req.body;

    const result = await authService.login(userId, password, role);

    // Set token in cookie
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };

    res.cookie('token', result.token, cookieOptions);

    return success(res, {
      token: result.token,
      user: result.user,
    }, 'Login successful');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

const logout = async (req, res, next) => {
  try {
    res.cookie('token', '', {
      httpOnly: true,
      expires: new Date(0),
    });

    return success(res, null, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user._id);
    return success(res, user, 'User fetched successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

module.exports = { login, logout, getMe };
