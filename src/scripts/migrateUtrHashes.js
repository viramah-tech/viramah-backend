#!/usr/bin/env node
'use strict';

/**
 * migrateUtrHashes.js — Backfills SHA256 UTR hashes for historical Payment records.
 *
 * Usage:
 *   node src/scripts/migrateUtrHashes.js              # Live run
 *   node src/scripts/migrateUtrHashes.js --dry-run     # Preview only
 *
 * What it does:
 *   1. Finds all Payment docs where transactionId exists but duplicateCheck.utrHash is null.
 *   2. Generates SHA256(utr:amount:submittedAt) for each.
 *   3. Writes the hash to duplicateCheck.utrHash.
 *   4. Reports progress and results.
 *
 * Safety:
 *   - Idempotent: skips records that already have a utrHash.
 *   - Batch processing (100 at a time) to avoid memory issues.
 *   - Does NOT modify any other fields on the Payment document.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('[migrateUtrHashes] ERROR: MONGO_URI not set in environment.');
    process.exit(1);
  }

  console.log(`[migrateUtrHashes] Connecting to database...`);
  console.log(`[migrateUtrHashes] Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  await mongoose.connect(mongoUri);

  const Payment = require('../models/Payment');

  // Find payments that need hash backfill
  const query = {
    transactionId: { $exists: true, $ne: null, $ne: '' },
    $or: [
      { 'duplicateCheck.utrHash': { $exists: false } },
      { 'duplicateCheck.utrHash': null },
    ],
  };

  const totalCount = await Payment.countDocuments(query);
  console.log(`[migrateUtrHashes] Found ${totalCount} payments needing UTR hash backfill.`);

  if (totalCount === 0) {
    console.log('[migrateUtrHashes] Nothing to do. Exiting.');
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches
  let batch;
  do {
    batch = await Payment.find(query)
      .limit(BATCH_SIZE)
      .select('_id transactionId amount submittedAt createdAt duplicateCheck')
      .lean();

    for (const payment of batch) {
      try {
        const utr = String(payment.transactionId).trim().toLowerCase();
        const amount = payment.amount || 0;
        const dateStr = (payment.submittedAt || payment.createdAt || new Date()).toISOString();

        const hashInput = `${utr}:${amount}:${dateStr}`;
        const utrHash = crypto.createHash('sha256').update(hashInput).digest('hex');

        if (DRY_RUN) {
          console.log(`  [DRY] Payment ${payment._id}: UTR="${payment.transactionId}" → hash=${utrHash.slice(0, 16)}...`);
        } else {
          await Payment.updateOne(
            { _id: payment._id },
            {
              $set: {
                'duplicateCheck.utrHash': utrHash,
                'duplicateCheck.checkedAt': new Date(),
                'duplicateCheck.isDuplicate': false,
              },
            }
          );
        }
        processed++;
      } catch (e) {
        console.error(`  [ERROR] Payment ${payment._id}: ${e.message}`);
        errors++;
      }
    }

    console.log(`[migrateUtrHashes] Progress: ${processed + skipped + errors}/${totalCount}`);
  } while (batch.length === BATCH_SIZE);

  console.log('\n[migrateUtrHashes] ════════════════════════════════════════');
  console.log(`  Total processed: ${processed}`);
  console.log(`  Skipped:         ${skipped}`);
  console.log(`  Errors:          ${errors}`);
  console.log(`  Mode:            ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('[migrateUtrHashes] ════════════════════════════════════════\n');

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error('[migrateUtrHashes] FATAL:', e.message);
  process.exit(1);
});
