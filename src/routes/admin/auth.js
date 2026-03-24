const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { login, logout, getMe } = require('../../controllers/admin/authController');

const router = express.Router();

router.post(
  '/login',
  [
    body('userId').trim().notEmpty().withMessage('User ID is required'),
    body('password').notEmpty().withMessage('Password is required'),
    body('role').trim().notEmpty().withMessage('Role is required'),
  ],
  validate,
  login
);

router.post('/logout', logout);

router.get('/me', protect, getMe);

module.exports = router;
