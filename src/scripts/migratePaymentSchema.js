'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Payment = require('../models/Payment');

const runMigration = async () => {
  try {
    await connectDB();
    console.log('Connected to DB...');

    const isDryRun = process.argv.includes('--dry-run');
    if (isDryRun) {
      console.log('--- DRY RUN MODE: No changes will be saved ---');
    } else {
      console.log('--- COMMIT MODE: Changes will be saved ---');
    }

    const unmigrated = await Payment.countDocuments({ type: { $exists: false } });
    console.log(`Found ${unmigrated} legacy payments without V3 'type' field.`);

    let processed = 0;
    
    // Process in batches
    const cursor = Payment.find({ type: { $exists: false } }).cursor();
    
    for await (const p of cursor) {
      // Map paymentType (V2) to type and category (V3)
      let nType = 'RENT';
      let nCategory = 'ROOM_RENT';

      if (p.paymentType === 'track3_booking') {
        nType = 'BOOKING';
        nCategory = 'SECURITY_DEPOSIT';
      } else if (p.paymentType === 'track2_phase1' || p.paymentType === 'track1_full') {
        nType = 'RENT';
        nCategory = 'INSTALLMENT_1';
      } else if (p.paymentType === 'track2_phase2') {
        nType = 'RENT';
        nCategory = 'INSTALLMENT_2';
      } else if (p.remarks && p.remarks.toLowerCase().includes('deposit')) {
        nType = 'BOOKING';
        nCategory = 'SECURITY_DEPOSIT';
      }

      p.type = nType;
      p.category = nCategory;

      // Migrate statuses safely over to V3 enums if needed
      // (Pre-rebuild 'upcoming' and 'on_hold' are retained per schema)

      p.precision = 'rupees'; // All old ones are rupees

      if (!isDryRun) {
        await p.save({ validateBeforeSave: false }); // Skip validation logic that might block immutable breakdown
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`Processed ${processed} payments...`);
      }
    }

    console.log(`Migration Complete. Processed: ${processed}.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

runMigration();
