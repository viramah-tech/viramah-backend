const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const requireTermsAccepted = require('../../middleware/requireTermsAccepted');
const { requireStep } = require('../../middleware/stepGuard');
const { validateIdNumber } = require('../../utils/idValidators');
const {
  getStatus,
  saveStep1,
  saveStep2,
  saveStep3,
  saveStep4,
  confirmOnboarding,
} = require('../../controllers/public/onboardingController');

const router = express.Router();

// All onboarding routes require authenticated resident who has accepted T&C
router.use(protect, authorize('user'), requireTermsAccepted);

// GET  /api/public/onboarding/status
router.get('/status', getStatus);

// PATCH /api/public/onboarding/step-1  (KYC documents)
router.patch(
  '/step-1',
  requireStep(1),
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
    body('idNumber').optional().trim().notEmpty().custom(validateIdNumber('idType')),
  ],
  validate,
  saveStep1
);

// PATCH /api/public/onboarding/step-2  (Emergency contact)
router.patch(
  '/step-2',
  requireStep(2),
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
    body('parentIdNumber').optional().trim().notEmpty().custom(validateIdNumber('parentIdType')),
  ],
  validate,
  saveStep2
);

// PATCH /api/public/onboarding/step-3  (Room selection)
router.patch(
  '/step-3',
  requireStep(3),
  saveStep3
);

// PATCH /api/public/onboarding/step-4  (Personal Details)
router.patch(
  '/step-4',
  requireStep(4),
  [
    body('gender').trim().notEmpty().withMessage('Gender is required'),
    body('address').trim().notEmpty().withMessage('Address is required'),
  ],
  validate,
  saveStep4
);

// POST /api/public/onboarding/confirm
router.post('/confirm', requireStep(4), confirmOnboarding);

module.exports = router;

