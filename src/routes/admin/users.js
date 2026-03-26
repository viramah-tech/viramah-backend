const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const { auditLog } = require('../../middleware/requestLogger');
const {
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
} = require('../../controllers/admin/userController');

const router = express.Router();

// All routes require authentication and admin role
router.use(protect, authorize('admin', 'accountant'));

router.get('/', getUsers);
router.get('/stats', getUserStats);

// Search and export must be BEFORE /:id to avoid route conflicts
router.get('/search/query', searchUsers);
router.get('/export/data', exportUsers);

router.get('/:id', getUserById);

router.post(
  '/',
  [
    body('userId').trim().notEmpty().withMessage('User ID is required'),
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
  ],
  validate,
  auditLog('CREATE_USER', 'user'),
  createUser
);

router.put('/:id', auditLog('UPDATE_USER', 'user'), updateUser);

router.patch(
  '/:id/status',
  [body('status').trim().notEmpty().withMessage('Status is required')],
  validate,
  auditLog('UPDATE_USER_STATUS', 'user'),
  updateUserStatus
);

// PATCH /:id/onboarding - Update onboarding status
router.patch(
  '/:id/onboarding',
  [body('onboardingStatus').trim().notEmpty().withMessage('Onboarding status is required')],
  validate,
  auditLog('UPDATE_ONBOARDING', 'user'),
  updateOnboardingStatus
);

// PATCH /:id/room - Assign/update room
router.patch(
  '/:id/room',
  [
    body('roomNumber').trim().notEmpty().withMessage('Room number is required'),
    body('roomType').trim().notEmpty().withMessage('Room type is required'),
  ],
  validate,
  auditLog('ASSIGN_ROOM', 'user'),
  updateRoom
);

// PATCH /:id/verify-documents - Approve document verification
router.patch(
  '/:id/verify-documents',
  auditLog('VERIFY_DOCUMENTS', 'user'),
  approveDocumentVerification
);

// PATCH /:id/complete-move-in - Complete move-in process
router.patch(
  '/:id/complete-move-in',
  auditLog('COMPLETE_MOVE_IN', 'user'),
  completeMoveIn
);

// POST /:id/change-password - Change user password (admin only)
router.post(
  '/:id/change-password',
  [body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')],
  validate,
  auditLog('CHANGE_PASSWORD', 'user'),
  changeUserPassword
);

// DELETE /:id - Delete user (admin only)
router.delete(
  '/:id',
  auditLog('DELETE_USER', 'user'),
  deleteUser
);

module.exports = router;
