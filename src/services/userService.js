const User = require('../models/User');
const { attachRoomTypeName } = require('../utils/attachRoomType');

const getUsers = async ({ page = 1, limit = 10, role, status, onboardingStatus }) => {
  const query = {};

  if (role) query.role = role;
  if (status) query.status = status;
  if (onboardingStatus) query.onboardingStatus = onboardingStatus;

  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .populate('roomTypeId', 'name'),
    User.countDocuments(query),
  ]);

  const processedUsers = users.map(u => {
    const obj = u.toObject ? u.toObject() : u;
    attachRoomTypeName(obj);
    return obj;
  });

  return {
    users: processedUsers,
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

const getUserStats = async () => {
  const [total, byRole, byStatus, recentSignups] = await Promise.all([
    User.countDocuments(),
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    User.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('userId name role status createdAt'),
  ]);

  // Convert aggregation results to objects
  const roleStats = {};
  byRole.forEach((r) => {
    roleStats[r._id] = r.count;
  });

  const statusStats = {};
  byStatus.forEach((s) => {
    statusStats[s._id] = s.count;
  });

  return {
    total,
    byRole: roleStats,
    byStatus: statusStats,
    recentSignups,
  };
};

const getUserById = async (id) => {
  const user = await User.findById(id).populate('roomTypeId', 'name');
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  const obj = user.toObject();
  attachRoomTypeName(obj);
  return obj;
};

const createUser = async (data) => {
  const existing = await User.findOne({ userId: data.userId });
  if (existing) {
    const err = new Error('User ID already exists');
    err.statusCode = 400;
    throw err;
  }

  const user = await User.create(data);
  return user;
};

const updateUser = async (id, data) => {
  // Don't allow password update through this endpoint
  delete data.password;

  const user = await User.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  return user;
};

const updateUserStatus = async (id, status) => {
  const validStatuses = ['active', 'inactive', 'suspended'];
  if (!validStatuses.includes(status)) {
    const err = new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const user = await User.findByIdAndUpdate(
    id,
    { status },
    { new: true, runValidators: true }
  );

  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  return user;
};

const changePassword = async (id, newPassword) => {
  const user = await User.findById(id).select('+password');
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  user.password = newPassword;
  await user.save(); // pre-save hook will hash it
  return user;
};

const searchUsers = async (query, { page = 1, limit = 10 }) => {
  // Escape regex metacharacters to prevent ReDoS attacks
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const searchRegex = new RegExp(escaped, 'i');
  const filter = {
    $or: [
      { name: searchRegex },
      { email: searchRegex },
      { userId: searchRegex },
      { phone: searchRegex },
      { roomNumber: searchRegex },
    ],
  };

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('roomTypeId', 'name'),
    User.countDocuments(filter),
  ]);

  const processedUsers = users.map(u => {
    const obj = u.toObject ? u.toObject() : u;
    attachRoomTypeName(obj);
    return obj;
  });

  return {
    users: processedUsers,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
  };
};

const exportUsers = async ({ role, status, onboardingStatus }) => {
  const query = {};
  if (role) query.role = role;
  if (status) query.status = status;
  if (onboardingStatus) query.onboardingStatus = onboardingStatus;

  const users = await User.find(query)
    .select('-password')
    .sort({ createdAt: -1 })
    .populate('roomTypeId', 'name')
    .lean();

  return users.map(u => {
    attachRoomTypeName(u);
    return u;
  });
};

const deleteUser = async (id) => {
  const user = await User.findById(id);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  if (user.role === 'admin') {
    const err = new Error('Cannot delete admin users');
    err.statusCode = 403;
    throw err;
  }

  // Release room occupancy if user had a booked seat
  if (user.roomTypeId) {
    const RoomType = require('../models/RoomType');
    await RoomType.findByIdAndUpdate(user.roomTypeId, {
      $inc: { bookedSeats: -1 },
    });
  }

  // Clean up ALL associated records
  const Payment     = require('../models/Payment');
  const Transaction = require('../models/Transaction');
  const RoomHold    = require('../models/RoomHold');
  const RefundRecord = require('../models/RefundRecord');

  await Promise.all([
    Payment.deleteMany({ userId: id }),
    Transaction.deleteMany({ userId: id }),
    RoomHold.deleteMany({ userId: id }),
    RefundRecord.deleteMany({ userId: id }),
  ]);

  await User.findByIdAndDelete(id);
  return { deleted: true, userId: user.userId };
};

module.exports = {
  getUsers,
  getUserStats,
  getUserById,
  createUser,
  updateUser,
  updateUserStatus,
  changePassword,
  searchUsers,
  exportUsers,
  deleteUser,
};
