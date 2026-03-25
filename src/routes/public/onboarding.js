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
router.patch(
  '/step-1',
  [
    body('fullName').optional().trim().notEmpty().withMessage('Full name is required'),
    body('dateOfBirth').optional().trim().notEmpty()
      .custom((value) => {
        if (!value) return true;
        const today = new Date();
        const birthDate = new Date(value);
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }
        if (age < 18) throw new Error('Must be at least 18 years old');
        return true;
      }),
    body('idType').optional().isIn(['aadhaar', 'passport', 'driving_license', 'voter_id']).withMessage('Invalid ID type'),
    body('idNumber').optional().trim().notEmpty().custom((value, { req }) => {
      const type = req.body.idType;
      if (!type) return true;
      const cleanVal = value.replace(/\s/g, "");
      if (type === 'aadhaar' && !/^\d{12}$/.test(cleanVal)) throw new Error('Aadhaar must be exactly 12 numeric digits');
      if (type === 'passport' && !/^[A-Z0-9]{8,9}$/.test(value)) throw new Error('Passport must be 8-9 uppercase alphanumeric characters');
      if (type === 'driving_license' && !/^[A-Z0-9]{15,16}$/.test(value)) throw new Error('Driving License must be 15-16 uppercase alphanumeric characters');
      if (type === 'voter_id' && !/^[A-Z0-9]{10}$/.test(value)) throw new Error('Voter ID must be exactly 10 uppercase alphanumeric characters');
      return true;
    })
  ],
  validate,
  saveStep1
);

// PATCH /api/public/onboarding/step-2  (Emergency contact)
router.patch(
  '/step-2',
  [
    body('name').optional().trim().notEmpty().withMessage('Contact name is required'),
    body('phone').optional().trim().notEmpty()
      .custom((value) => {
        const clean = value.replace(/\D/g, "");
        if (!/^\d{10}$/.test(clean)) throw new Error('Emergency phone must be exactly 10 numeric digits');
        return true;
      }),
    body('relation').optional().trim().notEmpty().withMessage('Relation is required'),
    body('alternatePhone').optional({ checkFalsy: true }).trim()
      .custom((value) => {
        const clean = value.replace(/\D/g, "");
        if (!/^\d{10}$/.test(clean)) throw new Error('Alternate phone must be exactly 10 numeric digits');
        return true;
      }),
    body('parentIdType').optional().isIn(['aadhaar', 'passport', 'driving_license', 'voter_id']).withMessage('Invalid Parent ID type'),
    body('parentIdNumber').optional().trim().notEmpty().custom((value, { req }) => {
      const type = req.body.parentIdType;
      if (!type) return true;
      const cleanVal = value.replace(/\s/g, "");
      if (type === 'aadhaar' && !/^\d{12}$/.test(cleanVal)) throw new Error('Aadhaar must be exactly 12 numeric digits');
      if (type === 'passport' && !/^[A-Z0-9]{8,9}$/.test(value)) throw new Error('Passport must be 8-9 uppercase alphanumeric characters');
      if (type === 'driving_license' && !/^[A-Z0-9]{15,16}$/.test(value)) throw new Error('Driving License must be 15-16 uppercase alphanumeric characters');
      if (type === 'voter_id' && !/^[A-Z0-9]{10}$/.test(value)) throw new Error('Voter ID must be exactly 10 uppercase alphanumeric characters');
      return true;
    })
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
