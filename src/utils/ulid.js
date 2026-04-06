'use strict';

/**
 * ULID wrapper — monotonically sortable, collision-free IDs.
 *
 * Plan rule (VIRAMAH_Payment_Rebuild_Plan, Section 0):
 *   "All new backend code must use ULID for ID generation — never countDocuments()"
 *
 * Uses the `ulid` package. If not installed, run:
 *     npm install ulid
 */

const { ulid, monotonicFactory } = require('ulid');

const monotonic = monotonicFactory();

/**
 * Generate a prefixed ULID, e.g. prefixed('PLN') → 'PLN-01HXYZ...'
 * @param {string} prefix
 * @returns {string}
 */
const prefixed = (prefix) => `${prefix}-${monotonic()}`;

module.exports = {
  ulid,
  monotonic,
  prefixed,
  planId:       () => prefixed('PLN'),
  paymentId:    () => prefixed('PAY'),
  transactionId:() => prefixed('TXN'),
  adjustmentId: () => prefixed('ADJ'),
};
