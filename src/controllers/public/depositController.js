'use strict';

const depositService = require('../../services/depositService');
const { success, error } = require('../../utils/apiResponse');

// ── POST /api/public/deposits/initiate ────────────────────────────────────────
/**
 * Resident submits the ₹15,000 deposit payment details.
 * Creates a RoomHold in status 'pending_approval'.
 * Admin must approve before the clock starts.
 */
const initiateDeposit = async (req, res) => {
  try {
    const userId    = req.user._id;
    const { roomTypeId, transactionId, receiptUrl } = req.body;

    const hold = await depositService.initiateDeposit(
      userId,
      roomTypeId,
      { transactionId, receiptUrl }
    );

    return success(res, 'Deposit payment submitted. Waiting for admin approval.', { hold }, 201);
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

// ── GET /api/public/deposits/status ───────────────────────────────────────────
/**
 * Returns the current user's most recent RoomHold with computed deadline fields.
 */
const getDepositStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const status = await depositService.getHoldStatus(userId);

    if (!status) {
      return success(res, 'No room hold found for your account.', { hold: null });
    }

    return success(res, 'Room hold status retrieved.', { hold: status });
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

// ── POST /api/public/deposits/request-refund ──────────────────────────────────
/**
 * Resident requests a refund.
 * Only valid within the 7-day refund window.
 * Admin still needs to approve — this just submits the request.
 */
const requestRefund = async (req, res) => {
  try {
    const userId = req.user._id;
    const { reason } = req.body;

    const refundRecord = await depositService.requestRefund(userId, reason);

    return success(
      res,
      'Refund request submitted. Admin will process it within 1-2 business days.',
      { refundRecord }
    );
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

module.exports = { initiateDeposit, getDepositStatus, requestRefund };
