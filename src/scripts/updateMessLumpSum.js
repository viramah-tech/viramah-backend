'use strict';

/**
 * One-time script to update messLumpSum from ₹19,000 to ₹19,900 in PricingConfig.
 *
 * Usage:  node src/scripts/updateMessLumpSum.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { PricingConfig } = require('../models/PricingConfig');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const result = await PricingConfig.updateOne(
      {},
      { $set: { messLumpSum: 19900 } }
    );

    if (result.modifiedCount > 0) {
      console.log('✅ messLumpSum updated to ₹19,900');
    } else {
      console.log('ℹ️  No change — messLumpSum may already be 19900 or no config document exists.');
    }

    // Verify
    const config = await PricingConfig.findOne().lean();
    console.log('Current messLumpSum:', config?.messLumpSum);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
