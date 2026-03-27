/**
 * migrateLegacyTermsAcceptance.js
 *
 * One-time (but idempotent) migration script:
 * - Finds all users who have NO termsAccepted record (field is false/null/undefined)
 * - AND have a completed onboarding status (onboardingStatus === 'completed')
 *   OR have an approved payment (paymentStatus === 'approved')
 * - Sets termsAccepted: true, termsVersion: 'legacy', termsAcceptedAt: user.createdAt
 * - Safe to run multiple times — skips users who already have termsAccepted: true
 *
 * Run: node src/scripts/migrateLegacyTermsAcceptance.js
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const User     = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/viramah';

async function run() {
  console.log('🔌 Connecting to MongoDB…');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  // Find legacy users: completed onboarding or approved payment, but no terms acceptance
  const legacyUsers = await User.find({
    $and: [
      { termsAccepted: { $ne: true } },
      {
        $or: [
          { onboardingStatus: 'completed' },
          { paymentStatus:    { $in: ['approved', 'pending'] } },
        ],
      },
    ],
  }).select('_id email name onboardingStatus paymentStatus createdAt');

  console.log(`Found ${legacyUsers.length} legacy users to migrate.\n`);

  if (legacyUsers.length === 0) {
    console.log('Nothing to do. Exiting.');
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  for (const user of legacyUsers) {
    await User.findByIdAndUpdate(user._id, {
      $set: {
        termsAccepted:           true,
        termsAcceptedAt:         user.createdAt,   // best approximation
        termsVersion:            'legacy',
        privacyPolicyAccepted:   true,
        privacyPolicyAcceptedAt: user.createdAt,
        privacyPolicyVersion:    'legacy',
        acceptanceIp:            'migration-script',
        acceptanceUserAgent:     'migration-script',
      },
    });
    console.log(`  ✔ Migrated: ${user.email} (${user._id})`);
    updated++;
  }

  console.log(`\n✅ Done. Migrated ${updated} user(s).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
