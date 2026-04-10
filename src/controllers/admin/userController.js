const userService = require('../../services/user-service');
const RoomType = require('../../models/RoomType');
const { success, error } = require('../../utils/apiResponse');
const { emitToAdmins, emitToUser } = require('../../services/socket-service');

const getUsers = async (req, res, next) => {
  try {
    const { page, limit, role, status, onboardingStatus } = req.query;
    const result = await userService.getUsers({ page, limit, role, status, onboardingStatus });
    return success(res, result, 'Users fetched successfully');
  } catch (err) {
    next(err);
  }
};

const getUserStats = async (req, res, next) => {
  try {
    const stats = await userService.getUserStats();
    return success(res, stats, 'User statistics fetched successfully');
  } catch (err) {
    next(err);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id);
    return success(res, user, 'User fetched successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

const createUser = async (req, res, next) => {
  try {
    const user = await userService.createUser(req.body);
    return success(res, user, 'User created successfully', 201);
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

// Field allowlist — ONLY these fields can be updated via PUT /api/admin/users/:id.
// Sensitive fields (role, paymentStatus, password, onboardingStatus) are BLOCKED.
const ALLOWED_UPDATE_FIELDS = [
  'name', 'email', 'phone', 'dateOfBirth', 'gender', 'address',
  'roomNumber', 'status',
  'emergencyContact',
];

const BLOCKED_SENSITIVE_FIELDS = ['role', 'password', 'paymentStatus'];

const updateUser = async (req, res, next) => {
  try {
    // Security: Log and block any attempt to change sensitive fields
    for (const field of BLOCKED_SENSITIVE_FIELDS) {
      if (req.body[field] !== undefined) {
        console.warn(
          `[SECURITY] Admin ${req.user._id} (${req.user.role}) attempted ` +
          `to change ${field} of user ${req.params.id} to "${req.body[field]}" ` +
          `via updateUser. Blocked by allowlist.`
        );
      }
    }

    // Build update object from allowlist only
    const updateData = {};
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return error(res, 'No valid fields provided for update', 400);
    }

    const user = await userService.updateUser(req.params.id, updateData);
    emitToUser(user._id.toString(), 'user:updated', user);
    emitToAdmins('user:updated', user);
    return success(res, user, 'User updated successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const user = await userService.updateUserStatus(req.params.id, status);
    emitToUser(user._id.toString(), 'user:updated', user);
    emitToAdmins('user:updated', user);
    return success(res, user, 'User status updated successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

const updateOnboardingStatus = async (req, res, next) => {
  try {
    const { onboardingStatus } = req.body;
    const validStatuses = ['pending', 'in-progress', 'completed', 'rejected'];
    if (!validStatuses.includes(onboardingStatus)) {
      return error(res, `Invalid onboarding status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }
    const user = await userService.updateUser(req.params.id, { onboardingStatus });
    emitToUser(user._id.toString(), 'user:updated', user);
    emitToAdmins('user:updated', user);
    return success(res, user, 'Onboarding status updated successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
};

const updateRoom = async (req, res, next) => {
  try {
    const { roomNumber, roomType } = req.body;
    let roomTypeId = null;
    
    if (roomType) {
      const roomTypeObj = await RoomType.findOne({ name: roomType, isActive: true });
      if (!roomTypeObj) {
        return error(res, 'Invalid room type', 400);
      }
      roomTypeId = roomTypeObj._id;
    }
    
    const user = await userService.updateUser(req.params.id, { roomNumber, roomTypeId });
    emitToUser(user._id.toString(), 'user:updated', user);
    emitToAdmins('user:updated', user);
    return success(res, user, 'Room assignment updated successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
};

const changeUserPassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    const user = await userService.changePassword(req.params.id, newPassword);
    return success(res, { userId: user.userId }, 'Password changed successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
};

const searchUsers = async (req, res, next) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;
    if (!q || q.trim().length < 2) {
      return error(res, 'Search query must be at least 2 characters', 400);
    }
    const result = await userService.searchUsers(q.trim(), { page, limit });
    return success(res, result, 'Search results fetched');
  } catch (err) {
    next(err);
  }
};

const exportUsers = async (req, res, next) => {
  try {
    const { role, status, onboardingStatus } = req.query;
    const users = await userService.exportUsers({ role, status, onboardingStatus });
    return success(res, { users, exportedAt: new Date().toISOString(), count: users.length }, 'Users exported');
  } catch (err) {
    next(err);
  }
};

const approveDocumentVerification = async (req, res, next) => {
  try {
    const User = require('../../models/User');
    const user = await User.findById(req.params.id);
    if (!user) return error(res, 'User not found', 404);

    if (user.paymentStatus !== 'approved') {
      return error(res, 'Payment must be approved before document verification', 400);
    }

    user.documentVerificationStatus = 'approved';
    await user.save();

    const updatedUser = await User.findById(user._id).populate('roomTypeId', 'name');
    const userData = updatedUser.toObject();
    userData.roomType = userData.roomTypeId ? userData.roomTypeId.name : '';

    emitToUser(user._id.toString(), 'user:updated', userData);
    emitToAdmins('user:updated', userData);
    return success(res, userData, 'Document verification approved');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
};

const completeMoveIn = async (req, res, next) => {
  try {
    const User = require('../../models/User');
    const user = await User.findById(req.params.id);
    if (!user) return error(res, 'User not found', 404);

    if (user.documentVerificationStatus !== 'approved') {
      return error(res, 'Documents must be verified before move-in', 400);
    }

    user.moveInStatus = 'completed';
    user.role = 'resident';
    await user.save();

    const updatedUser = await User.findById(user._id).populate('roomTypeId', 'name');
    const userData = updatedUser.toObject();
    userData.roomType = userData.roomTypeId ? userData.roomTypeId.name : '';

    emitToUser(user._id.toString(), 'user:updated', userData);
    emitToAdmins('user:updated', userData);
    return success(res, userData, 'Move-in completed, user promoted to resident');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const result = await userService.deleteUser(req.params.id);
    emitToAdmins('user:deleted', { userId: req.params.id });
    return success(res, result, 'User deleted successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

module.exports = {
  getUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  updateOnboardingStatus,
  updateRoom,
  changeUserPassword,
  searchUsers,
  exportUsers,
  approveDocumentVerification,
  completeMoveIn,
  deleteUser,
};
