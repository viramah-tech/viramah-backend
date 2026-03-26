'use strict';

const express       = require('express');
const { protect }   = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const { validateReferral } = require('../../controllers/public/paymentController');

const router = express.Router();

/**
 * GET /api/public/referral/validate/:code
 *
 * Validates a referral code without applying any credits.
 * Returns { valid: boolean, message: string }.
 * Auth is optional (allows unauthenticated users during onboarding).
 */
router.get('/validate/:code', validateReferral);

module.exports = router;
