'use strict';

const depositService = require('../../services/depositService');
const { success, error } = require('../../utils/apiResponse');

const DEPOSIT_AMOUNT    = 15000;
const REGISTRATION_FEE  = 1000;
const TOTAL_DEPOSIT     = 16000;

// ── POST /api/public/deposits/initiate ────────────────────────────────────────
/**
 * Resident submits a deposit payment. Supports three modes:
 *   'full'    → ₹15,000 security deposit only (choosing full payment mode)
 *   'half'    → ₹15,000 security deposit only (choosing half payment mode)
 *   'deposit' → ₹16,000 (₹15,000 security + ₹1,000 registration, payment mode chosen later)
 */
const initiateDeposit = async (req, res) => {
  try {
    const userId = req.user._id;
    const { roomTypeId, paymentMode, transactionId, receiptUrl } = req.body;

    if (!paymentMode) {
      return error(res, 'paymentMode is required ("full", "half", or "deposit")', 400);
    }

    const hold = await depositService.initiateDeposit(
      userId,
      roomTypeId,
      paymentMode,
      { transactionId, receiptUrl }
    );

    // For deposit-only mode, return explicit breakdown showing ₹15,000 + ₹1,000
    const breakdown = paymentMode === 'deposit'
      ? {
          securityDeposit:     DEPOSIT_AMOUNT,
          registrationFee:     REGISTRATION_FEE,
          totalPaidNow:        TOTAL_DEPOSIT,
          refundableAmount:    DEPOSIT_AMOUNT,
          nonRefundableAmount: REGISTRATION_FEE,
          isDepositOnly:       true,
        }
      : null;

    return success(res, {
      hold,
      ...(breakdown ? { breakdown } : {}),
    }, 'Deposit payment submitted. Waiting for admin approval.', 201);
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

// ── GET /api/public/deposits/status ───────────────────────────────────────────
/**
 * Returns the current user's most recent RoomHold with computed deadline fields.
 * For deposit-only holds, also returns refundableAmount and nonRefundableAmount.
 */
const getDepositStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const hold = await depositService.getDepositOnlyStatus(userId);

    if (!hold) {
      return success(res, { hold: null }, 'No room hold found for your account.');
    }

    return success(res, { hold }, 'Room hold status retrieved.');
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

// ── POST /api/public/deposits/request-refund ──────────────────────────────────
/**
 * Resident requests a refund of the SECURITY DEPOSIT ONLY (₹15,000).
 * The ₹1,000 registration fee is NEVER refundable — enforced server-side.
 */
const requestRefund = async (req, res) => {
  try {
    const userId = req.user._id;
    const { reason } = req.body;

    const refundRecord = await depositService.requestRefund(userId, reason);

    return success(res, {
      refundRecord,
      refundableAmount:    DEPOSIT_AMOUNT,
      nonRefundableAmount: REGISTRATION_FEE,
      notice: 'Only the ₹15,000 security deposit is refundable. The ₹1,000 registration fee is non-refundable under any circumstances.',
    }, 'Refund request submitted. Admin will process it within 1-2 business days.');
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

module.exports = { initiateDeposit, getDepositStatus, requestRefund };
