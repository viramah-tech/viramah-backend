#!/usr/bin/env node
'use strict';

/**
 * migrateIdempotencyKeys.js — Backfills UUID v4 idempotency keys for historical
 * Payment records that are missing them.
 *
 * Usage:
 *   node src/scripts/migrateIdempotencyKeys.js              # Live run
 *   node src/scripts/migrateIdempotencyKeys.js --dry-run     # Preview only
 *
 * What it does:
 *   1. Finds all Payment docs where idempotencyKey is null/missing.
 *   2. Generates a UUID v4 for each.
 *   3. Writes it to the idempotencyKey field.
 *
 * Safety:
 *   - Idempotent: skips records that already have an idempotencyKey.
 *   - Batch processing (100 at a time).
 *   - Does NOT modify any other fields on the Payment document.
 */

const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100;

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('[migrateIdempotencyKeys] ERROR: MONGO_URI not set in environment.');
    process.exit(1);
  }

  console.log(`[migrateIdempotencyKeys] Connecting to database...`);
  console.log(`[migrateIdempotencyKeys] Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  await mongoose.connect(mongoUri);

  const Payment = require('../models/Payment');

  const query = {
    $or: [
      { idempotencyKey: { $exists: false } },
      { idempotencyKey: null },
      { idempotencyKey: '' },
    ],
  };

  const totalCount = await Payment.countDocuments(query);
  console.log(`[migrateIdempotencyKeys] Found ${totalCount} payments needing idempotency key backfill.`);

  if (totalCount === 0) {
    console.log('[migrateIdempotencyKeys] Nothing to do. Exiting.');
    await mongoose.disconnect();
    return;
  }

  let processed = 0;
  let errors = 0;

  let batch;
  do {
    batch = await Payment.find(query)
      .limit(BATCH_SIZE)
      .select('_id idempotencyKey')
      .lean();

    for (const payment of batch) {
      try {
        const key = uuidv4();

        if (DRY_RUN) {
          console.log(`  [DRY] Payment ${payment._id}: → idempotencyKey=${key}`);
        } else {
          await Payment.updateOne(
            { _id: payment._id },
            { $set: { idempotencyKey: key } }
          );
        }
        processed++;
      } catch (e) {
        console.error(`  [ERROR] Payment ${payment._id}: ${e.message}`);
        errors++;
      }
    }

    console.log(`[migrateIdempotencyKeys] Progress: ${processed + errors}/${totalCount}`);
  } while (batch.length === BATCH_SIZE);

  console.log('\n[migrateIdempotencyKeys] ════════════════════════════════════════');
  console.log(`  Total processed: ${processed}`);
  console.log(`  Errors:          ${errors}`);
  console.log(`  Mode:            ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('[migrateIdempotencyKeys] ════════════════════════════════════════\n');

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error('[migrateIdempotencyKeys] FATAL:', e.message);
  process.exit(1);
});
