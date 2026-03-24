const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const { register, login, logout, getMe } = require('../../controllers/public/authController');

const router = express.Router();

// POST /api/public/auth/register
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
  ],
  validate,
  register
);

// POST /api/public/auth/login
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  login
);

// POST /api/public/auth/logout
router.post('/logout', logout);

// GET /api/public/auth/me (protected - resident only)
router.get('/me', protect, authorize('user'), getMe);

module.exports = router;
