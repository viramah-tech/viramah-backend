'use strict';

const { assertCanEnterStep } = require('../services/onboarding-state-service');

/**
 * requireStep(n) — Express middleware that 409s if the authenticated user
 * has not yet reached step `n` in their onboarding flow.
 *
 * Usage:
 *   router.patch('/step-2', requireStep(2), ctrl.saveStep2);
 */
function requireStep(step) {
  return async (req, res, next) => {
    try {
      assertCanEnterStep(req.user, step);
      next();
    } catch (err) {
      if (err.code === 'STEP_OUT_OF_ORDER' || err.code === 'ONBOARDING_COMPLETED') {
        return res.status(err.status).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
            nextAllowedStep: err.nextAllowedStep ?? null,
          },
        });
      }
      next(err);
    }
  };
}

module.exports = { requireStep };
