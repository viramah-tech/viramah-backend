'use strict';

/**
 * onboarding-state.service.js — Pure functions for server-side step gating.
 *
 * The User model does NOT carry a `completedSteps` array. Instead we derive
 * which steps are complete from the presence of the fields each step populates.
 */

const STEP_ORDER = [1, 2, 3, 4];

/**
 * Determine which onboarding steps a user has completed, based on field presence.
 *
 * Step 1 — KYC:             documents.idProof, idType, idNumber
 * Step 2 — Emergency:       emergencyContact.name, emergencyContact.phone
 * Step 3 — Room selection:  roomTypeId
 * Step 4 — Personal details: gender, address
 */
function deriveCompletedSteps(user) {
  const completed = [];

  // Step 1: KYC documents + identity fields
  if (user.documents?.idProof && user.idType && user.idNumber) {
    completed.push(1);
  }

  // Step 2: Emergency contact
  if (user.emergencyContact?.name && user.emergencyContact?.phone) {
    completed.push(2);
  }

  // Step 3: Room selection
  if (user.roomTypeId) {
    completed.push(3);
  }

  // Step 4: Personal details
  if (user.gender && user.address) {
    completed.push(4);
  }

  return completed;
}

function highestCompletedStep(user) {
  const completed = deriveCompletedSteps(user);
  return completed.length ? Math.max(...completed) : 0;
}

function nextAllowedStep(user) {
  const status = user?.onboardingStatus;
  if (status === 'completed') return null;

  // Walk through steps in order — the first gap is the next allowed step
  const completed = new Set(deriveCompletedSteps(user));
  for (const step of STEP_ORDER) {
    if (!completed.has(step)) return step;
  }

  // All 4 steps done but status not yet 'completed' — user should confirm
  return 4;
}

function assertCanEnterStep(user, step) {
  const allowed = nextAllowedStep(user);

  if (allowed === null) {
    const err = new Error('Onboarding already completed');
    err.code = 'ONBOARDING_COMPLETED';
    err.status = 409;
    throw err;
  }

  if (step > allowed) {
    const err = new Error(`Step ${step} is not yet accessible`);
    err.code = 'STEP_OUT_OF_ORDER';
    err.status = 409;
    err.nextAllowedStep = allowed;
    throw err;
  }
}

module.exports = {
  assertCanEnterStep,
  nextAllowedStep,
  highestCompletedStep,
  deriveCompletedSteps,
  STEP_ORDER,
};
