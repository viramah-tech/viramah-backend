const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const { register, login, logout, getMe, acceptTerms, forgotPasswordSendOtp, forgotPasswordVerifyOtp, forgotPasswordReset } = require('../../controllers/public/authController');

const router = express.Router();

// POST /api/public/auth/register
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required')
      .isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .custom((value, { req }) => {
        if (req.body.email && value.toLowerCase() === req.body.email.toLowerCase()) {
          throw new Error('Password must not be the same as your email');
        }
        if (req.body.name && value.toLowerCase() === req.body.name.trim().toLowerCase()) {
          throw new Error('Password must not be the same as your name');
        }
        return true;
      }),
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

// POST /api/public/auth/accept-terms (protected - record T&C + Privacy Policy acceptance)
router.post('/accept-terms', protect, authorize('user'), acceptTerms);

// ── Forgot Password ──────────────────────────────────────────────────────────
router.post(
  '/forgot-password/send-otp',
  [
    body('email').isEmail().withMessage('Valid email is required'),
  ],
  validate,
  forgotPasswordSendOtp
);

router.post(
  '/forgot-password/verify-otp',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate,
  forgotPasswordVerifyOtp
);

router.post(
  '/forgot-password/reset',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
  ],
  validate,
  forgotPasswordReset
);

module.exports = router;
