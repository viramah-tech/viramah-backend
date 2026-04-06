'use strict';

/**
 * Seed script — creates the two canonical discount_config documents.
 * Plan Section 10 Phase B.
 *
 * Run:
 *   node src/scripts/seedDiscountConfig.js
 *
 * Idempotent: running repeatedly will not create duplicates.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const DiscountConfig = require('../models/DiscountConfig');

const SEEDS = [
  { trackId: 'full',    defaultDiscountRate: 0.40, appliesTo: 'rent_only', isActive: true },
  { trackId: 'twopart', defaultDiscountRate: 0.25, appliesTo: 'rent_only', isActive: true },
];

async function run() {
  await connectDB();
  for (const seed of SEEDS) {
    const existing = await DiscountConfig.findOne({ trackId: seed.trackId });
    if (existing) {
      console.log(`[seed] discount_config '${seed.trackId}' already exists — skipping`);
      continue;
    }
    await DiscountConfig.create({
      ...seed,
      updatedBy: { name: 'system-seed', role: 'system' },
      history: [],
    });
    console.log(`[seed] discount_config '${seed.trackId}' created @ ${seed.defaultDiscountRate}`);
  }
  await mongoose.disconnect();
  console.log('[seed] done');
}

run().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
