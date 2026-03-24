const express = require('express');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const AuditLog = require('../../models/AuditLog');
const { success } = require('../../utils/apiResponse');

const router = express.Router();
router.use(protect, authorize('admin'));

// GET /api/admin/audit - Get audit logs with pagination and filtering
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, action, resource, userId, startDate, endDate } = req.query;
    const query = {};

    if (action) query.action = action;
    if (resource) query.resource = resource;
    if (userId) query.userId = userId;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    return success(res, {
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    }, 'Audit logs fetched successfully');
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/audit/stats - Audit log statistics
router.get('/stats', async (req, res, next) => {
  try {
    const [byAction, byResource, recentCount] = await Promise.all([
      AuditLog.aggregate([
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      AuditLog.aggregate([
        { $group: { _id: '$resource', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      AuditLog.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
    ]);

    return success(res, { byAction, byResource, last24Hours: recentCount }, 'Audit stats fetched');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
