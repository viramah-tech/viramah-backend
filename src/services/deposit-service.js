'use strict';

/**
 * [CLEANUP-DETECTED] File depositService.js has been soft-removed.
 * These methods are stubs referencing the V2 Booking flows. 
 */

const Booking = require('../models/Booking');

const warn = (method) => console.warn(`[DEPRECATED] depositService.${method} called - investigating before hard removal.`);

async function initiateDeposit() {
  warn('initiateDeposit');
  throw new Error('Endpoint V1 Deprecated. Use V2 /api/v1/booking endpoints.');
}
async function reviewDepositProof() {
  warn('reviewDepositProof');
}
async function getRoomHoldStatus() {
  warn('getRoomHoldStatus');
  return null;
}
async function getDepositOnlyStatus() {
  warn('getDepositOnlyStatus');
  return null; // Return null so the frontend gracefully receives empty object instead of 500 crash
}
async function requestRefund() {
  warn('requestRefund');
}
async function listRefundRequests() {
  warn('listRefundRequests');
}
async function approveRefund() {
  warn('approveRefund');
}
async function rejectRefund() {
  warn('rejectRefund');
}
async function expireOverdueHolds() {
  warn('expireOverdueHolds');
}
async function addPhysicalReceipt() {
  warn('addPhysicalReceipt');
}

module.exports = {
  initiateDeposit,
  reviewDepositProof,
  getRoomHoldStatus,
  getDepositOnlyStatus,
  requestRefund,
  listRefundRequests,
  approveRefund,
  rejectRefund,
  expireOverdueHolds,
  addPhysicalReceipt
};
