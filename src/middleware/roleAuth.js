const { error } = require('../utils/apiResponse');

/**
 * Legacy role-based authorization. Checks if req.user.role is in the allowed list.
 * Retained for backward compat with existing V2 routes.
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'Not authorized', 401);
    }

    if (!roles.includes(req.user.role)) {
      return error(
        res,
        `Role '${req.user.role}' is not authorized to access this resource`,
        403
      );
    }

    next();
  };
};

// ── V3 Capability-Based Authorization ──────────────────────────────────────────
//
// Maps existing User.role values to V3 capability sets from the security spec:
//   ADMIN_SUPER    → admin
//   ADMIN_MANAGER  → manager
//   ADMIN_VERIFIER → accountant
//
// This avoids a breaking DB migration (no new role enum values needed).
// Routes specify required capabilities; the middleware checks if the user's
// role grants at least one of the requested capabilities.

const CAPABILITIES = {
  VERIFY_PAYMENTS:    'VERIFY_PAYMENTS',
  MANAGE_BOOKINGS:    'MANAGE_BOOKINGS',
  EXTEND_DEADLINES:   'EXTEND_DEADLINES',
  ADJUST_DISCOUNTS:   'ADJUST_DISCOUNTS',
  VIEW_RECONCILIATION: 'VIEW_RECONCILIATION',
  UPLOAD_STATEMENTS:  'UPLOAD_STATEMENTS',
  MANAGE_CONFIG:      'MANAGE_CONFIG',
  VIEW_AUDIT:         'VIEW_AUDIT',
  PAYMENT_OVERRIDE:   'PAYMENT_OVERRIDE',
};

/**
 * Role → capabilities mapping.
 * Higher roles inherit all capabilities of lower roles.
 */
const ROLE_CAPABILITIES = {
  // ADMIN_SUPER: full access
  admin: new Set(Object.values(CAPABILITIES)),

  // ADMIN_MANAGER: booking management, deadlines, discounts, reconciliation view
  manager: new Set([
    CAPABILITIES.VERIFY_PAYMENTS,
    CAPABILITIES.MANAGE_BOOKINGS,
    CAPABILITIES.EXTEND_DEADLINES,
    CAPABILITIES.ADJUST_DISCOUNTS,
    CAPABILITIES.VIEW_RECONCILIATION,
    CAPABILITIES.UPLOAD_STATEMENTS,
  ]),

  // ADMIN_VERIFIER: payment verification and read-only booking access
  accountant: new Set([
    CAPABILITIES.VERIFY_PAYMENTS,
    CAPABILITIES.VIEW_RECONCILIATION,
    CAPABILITIES.UPLOAD_STATEMENTS,
  ]),
};

/**
 * V3 capability-based authorization middleware.
 *
 * Usage: authorizeV3('VERIFY_PAYMENTS', 'MANAGE_BOOKINGS')
 * Allows access if the user's role grants ANY of the listed capabilities.
 *
 * @param  {...string} requiredCapabilities - One or more capability names
 */
const authorizeV3 = (...requiredCapabilities) => {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'Not authorized', 401);
    }

    const userRole = req.user.role;
    const userCapabilities = ROLE_CAPABILITIES[userRole];

    if (!userCapabilities) {
      return error(
        res,
        `Role '${userRole}' has no V3 capabilities assigned`,
        403
      );
    }

    const hasCapability = requiredCapabilities.some((cap) =>
      userCapabilities.has(cap)
    );

    if (!hasCapability) {
      return error(
        res,
        `Insufficient permissions. Required: ${requiredCapabilities.join(' or ')}`,
        403
      );
    }

    next();
  };
};

module.exports = { authorize, authorizeV3, CAPABILITIES, ROLE_CAPABILITIES };
