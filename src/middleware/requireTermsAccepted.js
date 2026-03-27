'use strict';

/**
 * Middleware: requireTermsAccepted
 *
 * Ensures the authenticated user has accepted the Terms & Conditions and
 * Privacy Policy before proceeding to protected onboarding routes.
 *
 * Must be used AFTER the `protect` middleware so req.user is populated.
 *
 * Returns 403 TERMS_NOT_ACCEPTED if user has not yet accepted.
 */
const requireTermsAccepted = (req, res, next) => {
  if (!req.user) {
    // Should not happen if protect runs first, but guard defensively
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  if (req.user.termsAccepted !== true) {
    return res.status(403).json({
      success: false,
      error: 'TERMS_NOT_ACCEPTED',
      message: 'Please accept the Terms & Conditions and Privacy Policy to continue.',
    });
  }

  next();
};

module.exports = requireTermsAccepted;
