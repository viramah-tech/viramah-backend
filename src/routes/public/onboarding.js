const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const {
  getStatus,
  saveStep1,
  saveStep2,
  saveStep3,
  saveStep4,
  confirmOnboarding,
  getAvailableRooms,
} = require('../../controllers/public/onboardingController');

const router = express.Router();

// All onboarding routes require authenticated resident
router.use(protect, authorize('user'));

// GET  /api/public/onboarding/status
router.get('/status', getStatus);

// PATCH /api/public/onboarding/step-1  (KYC documents)
router.patch('/step-1', saveStep1);

// PATCH /api/public/onboarding/step-2  (Emergency contact)
router.patch(
  '/step-2',
  [
    body('name').trim().notEmpty().withMessage('Contact name is required'),
    body('phone').trim().notEmpty().withMessage('Contact phone is required'),
    body('relation').trim().notEmpty().withMessage('Relation is required'),
  ],
  validate,
  saveStep2
);

// PATCH /api/public/onboarding/step-3  (Room selection)
router.patch(
  '/step-3',
  [
    body('roomId').trim().notEmpty().withMessage('Room selection is required'),
  ],
  validate,
  saveStep3
);

// PATCH /api/public/onboarding/step-4  (Preferences)
router.patch(
  '/step-4',
  [
    body('diet').trim().notEmpty().withMessage('Diet preference is required'),
    body('sleepSchedule').trim().notEmpty().withMessage('Sleep schedule is required'),
    body('noise').trim().notEmpty().withMessage('Noise preference is required'),
  ],
  validate,
  saveStep4
);

// POST /api/public/onboarding/confirm
router.post('/confirm', confirmOnboarding);

// GET /api/public/rooms/available  (also protected, resident must be logged in)
router.get('/rooms', getAvailableRooms);

module.exports = router;
