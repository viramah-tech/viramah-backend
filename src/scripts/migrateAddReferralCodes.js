'use strict';

/**
 * migrateAddReferralCodes.js
 *
 * One-time migration script to backfill `referralCode` on all existing User documents
 * that don't yet have one. Safe to run multiple times (idempotent).
 *
 * Usage:
 *   cd viramah-backend
 *   node src/scripts/migrateAddReferralCodes.js
 *
 * Requires .env to be present (for MONGO_URI / DB connection).
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const crypto   = require('crypto');

const User = require('../models/User');

/** @returns {string} 6-char uppercase alphanumeric suffix */
const generateSuffix = () =>
  crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);

/**
 * Generates a unique referral code that doesn't exist in the DB yet.
 * @returns {Promise<string>}
 */
const generateUniqueCode = async () => {
  for (let i = 0; i < 10; i++) {
    const code = `VIR-${generateSuffix()}`;
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  // Extremely unlikely fallback
  return `VIR-${Date.now().toString(36).toUpperCase().slice(-6)}`;
};

const run = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable not set.');

  console.log('🔗 Connecting to database...');
  const connectOptions = {};
  if (uri.includes('tls=true')) {
    const fs = require('fs');
    const caPath = require('path').join(__dirname, '../../global-bundle.pem');
    if (fs.existsSync(caPath)) {
      connectOptions.tls = true;
      connectOptions.tlsCAFile = caPath;
      connectOptions.tlsAllowInvalidHostnames = true;
      connectOptions.directConnection = true;
      connectOptions.authMechanism = 'SCRAM-SHA-1';
      connectOptions.authSource = 'admin';
    }
  }
  await mongoose.connect(uri, connectOptions);
  console.log('✅ Connected.\n');

  // Find all users missing a referral code
  const usersToMigrate = await User.find({
    $or: [
      { referralCode: { $exists: false } },
      { referralCode: null },
      { referralCode: '' },
    ],
  }).select('_id userId name').lean();

  console.log(`📋 Found ${usersToMigrate.length} user(s) without a referral code.\n`);

  if (usersToMigrate.length === 0) {
    console.log('✅ Nothing to migrate. All users already have referral codes.');
    await mongoose.disconnect();
    return;
  }

  let success = 0;
  let failed  = 0;

  for (const u of usersToMigrate) {
    try {
      const code = await generateUniqueCode();
      await User.updateOne({ _id: u._id }, { $set: { referralCode: code } });
      console.log(`  ✅ [${u.userId || u._id}] (${u.name}) → ${code}`);
      success++;
    } catch (err) {
      console.error(`  ❌ [${u.userId || u._id}] Failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n🏁 Migration complete: ${success} succeeded, ${failed} failed.`);
  await mongoose.disconnect();
  console.log('🔌 Disconnected from database.');
};

run().catch((err) => {
  console.error('💥 Migration failed:', err.message);
  process.exit(1);
});
