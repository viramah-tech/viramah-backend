'use strict';

/**
 * idValidators.js — Shared validation functions for Indian identity documents.
 * Used by onboarding route validators (step-1 and step-2) to avoid duplication.
 */

/**
 * Validation rules keyed by document type.
 * Each rule has a regex pattern and a human-readable error message.
 */
const ID_RULES = {
  aadhaar: {
    // Aadhaar is 12 digits (spaces allowed in input, stripped before validation)
    test: (value) => /^\d{12}$/.test(value.replace(/\s/g, '')),
    message: 'Aadhaar must be exactly 12 numeric digits',
  },
  passport: {
    test: (value) => /^[A-Z0-9]{8,9}$/.test(value),
    message: 'Passport must be 8-9 uppercase alphanumeric characters',
  },
  driving_license: {
    test: (value) => /^[A-Z0-9]{15,16}$/.test(value),
    message: 'Driving License must be 15-16 uppercase alphanumeric characters',
  },
  voter_id: {
    test: (value) => /^[A-Z0-9]{10}$/.test(value),
    message: 'Voter ID must be exactly 10 uppercase alphanumeric characters',
  },
};

/**
 * Express-validator custom validator for identity document numbers.
 * 
 * @param {string} typeFieldName - Name of the body field containing the ID type
 *                                 (e.g. 'idType' for step-1, 'parentIdType' for step-2)
 * @returns {Function} Custom validator function for express-validator
 * 
 * Usage in route:
 *   body('idNumber').optional().trim().notEmpty().custom(validateIdNumber('idType'))
 *   body('parentIdNumber').optional().trim().notEmpty().custom(validateIdNumber('parentIdType'))
 */
const validateIdNumber = (typeFieldName) => (value, { req }) => {
  const type = req.body[typeFieldName];
  if (!type) return true; // No type selected — skip validation

  const rule = ID_RULES[type];
  if (!rule) return true; // Unknown type — skip (express-validator isIn handles this)

  if (!rule.test(value)) {
    throw new Error(rule.message);
  }

  return true;
};

module.exports = { validateIdNumber, ID_RULES };
