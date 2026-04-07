'use strict';

/**
 * depositExpiry — R5.6: Registers the expireOverdueHolds function as a daily cron.
 *
 * The function already exists in depositService.js. This job just wires it
 * into the cron scheduler. Runs daily at 02:30 AM IST.
 */

const cron = require('node-cron');
const { expireOverdueHolds } = require('../services/depositService');

function registerDepositExpiry() {
  cron.schedule('30 2 * * *', async () => {
    try {
      await expireOverdueHolds();
    } catch (err) {
      console.error('[depositExpiry] Cron error:', err.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  console.log('[depositExpiry] Registered — runs daily at 02:30 AM IST');
}

module.exports = { registerDepositExpiry };
