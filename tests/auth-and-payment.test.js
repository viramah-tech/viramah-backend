const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const authService = require('../src/services/authService');
const paymentService = require('../src/services/paymentService');
const User = require('../src/models/User');
const { reconcileAccountState } = require('../src/utils/accountState');
const { collectReferencedS3KeysFromUsers, findOrphanedS3Keys, splitS3KeysByReference } = require('../src/utils/s3Cleanup');

test('login accepts phone-based credentials', async () => {
  const originalFindOne = User.findOne;
  const originalCompare = bcrypt.compare;

  const fakeUser = {
    basicInfo: {
      userId: 'RES001',
      fullName: 'Tejas Tiwari',
      email: 'tejas@example.com',
      phone: '9634010474',
    },
    auth: {
      passwordHash: 'hash',
      loginAttempts: 0,
    },
    accountStatus: 'pending',
    role: 'user',
    save: async () => {},
  };

  User.findOne = async () => fakeUser;
  bcrypt.compare = async () => true;

  try {
    const result = await authService.login({ phone: '9634010474', password: 'secret123' });
    assert.equal(result.basicInfo.userId, 'RES001');
    assert.equal(result.basicInfo.phone, '9634010474');
  } finally {
    User.findOne = originalFindOne;
    bcrypt.compare = originalCompare;
  }
});

test('payment proof validator accepts local and data URLs for fallback', () => {
  assert.doesNotThrow(() => paymentService.validateProofUrl('http://localhost:3000/uploads/receipt.png'));
  assert.doesNotThrow(() => paymentService.validateProofUrl('data:image/png;base64,abc123'));
});

test('reconcileAccountState activates a user after onboarding and payment completion', () => {
  const user = {
    accountStatus: 'pending',
    onboarding: { currentStep: 'booking_payment' },
    verification: { documentVerified: true },
    paymentSummary: { isFullyPaid: true },
    roomDetails: { status: 'checked_in' },
  };

  const result = reconcileAccountState(user);
  assert.equal(result.accountStatus, 'active');
  assert.equal(result.onboarding.currentStep, 'completed');
});

test('reconcileAccountState treats selected room types as readiness', () => {
  const user = {
    accountStatus: 'pending',
    onboarding: { currentStep: 'final_payment' },
    verification: { documentVerified: true },
    paymentSummary: { isFullyPaid: true },
    roomDetails: { roomType: 'room-123' },
  };

  const result = reconcileAccountState(user);
  assert.equal(result.accountStatus, 'active');
  assert.equal(result.onboarding.currentStep, 'completed');
});

test('cleanup logic keeps S3 files that are still linked from nested user data', () => {
  const users = [{
    profile: {
      documents: [{
        url: 'https://example.com/documents/keep-me.pdf',
      }],
    },
  }];

  const referenced = collectReferencedS3KeysFromUsers(users);
  const objectKeys = ['documents/keep-me.pdf', 'documents/remove-me.pdf'];
  const orphaned = findOrphanedS3Keys(objectKeys, referenced);
  const { referencedInBucket, orphaned: splitOrphaned } = splitS3KeysByReference(objectKeys, referenced);

  assert.deepEqual(Array.from(referenced), ['documents/keep-me.pdf']);
  assert.deepEqual(orphaned, ['documents/remove-me.pdf']);
  assert.deepEqual(referencedInBucket, ['documents/keep-me.pdf']);
  assert.deepEqual(splitOrphaned, ['documents/remove-me.pdf']);
});
