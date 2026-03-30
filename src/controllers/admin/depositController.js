'use strict';

const RoomHold     = require('../../models/RoomHold');
const RefundRecord = require('../../models/RefundRecord');
const User         = require('../../models/User');
const depositService = require('../../services/depositService');
const { success, error } = require('../../utils/apiResponse');
const { sendEmail } = require('../../services/emailService');
const { generateReceiptPdf } = require('../../services/pdfService');
const { buildDepositReceiptEmailHtml } = require('../../templates/depositReceiptEmail');

// ── GET /api/admin/deposits ───────────────────────────────────────────────────
/**
 * List all room holds. Filter by status via ?status=active|pending_approval|etc.
 */
const listDeposits = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const [holds, total] = await Promise.all([
      RoomHold.find(filter)
        .populate('userId',     'userId name email phone')
        .populate('roomTypeId', 'name displayName')
        .populate('approvedBy', 'userId name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      RoomHold.countDocuments(filter),
    ]);

    // Attach computed fields
    const now = Date.now();
    const holdsWithComputed = holds.map((h) => ({
      ...h,
      daysUntilRefundDeadline: h.refundDeadline
        ? Math.ceil((new Date(h.refundDeadline) - now) / (1000 * 60 * 60 * 24))
        : null,
      daysUntilPaymentDeadline: h.paymentDeadline
        ? Math.ceil((new Date(h.paymentDeadline) - now) / (1000 * 60 * 60 * 24))
        : null,
    }));

    return success(res, {
      holds: holdsWithComputed,
      pagination: { total, page: Number(page), limit: Number(limit) },
    }, 'Room holds retrieved.');
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

// ── GET /api/admin/deposits/stats ─────────────────────────────────────────────
/**
 * Get aggregate statistics for the deposit dashboard.
 */
const getDepositStats = async (req, res) => {
  try {
    const [stats] = await RoomHold.aggregate([
      {
        $group: {
          _id: null,
          pending:   { $sum: { $cond: [{ $eq: ['$status', 'pending_approval'] }, 1, 0] } },
          active:    { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          refunded:  { $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, 1, 0] } },
        },
      },
    ]);

    const defaultStats = { pending: 0, active: 0, converted: 0, refunded: 0 };
    return success(res, stats || defaultStats, 'Deposit statistics retrieved.');
  } catch (err) {
    return error(res, err.message, 500);
  }
};

// ── PATCH /api/admin/deposits/:holdId/approve ─────────────────────────────────
/**
 * Admin approves the deposit — starts the refund + payment deadline clocks.
 */
const approveDeposit = async (req, res) => {
  try {
    const { holdId } = req.params;
    const adminId    = req.user._id;

    const hold = await depositService.approveDeposit(holdId, adminId);

    // Send deposit receipt email with PDF (non-blocking)
    try {
      const user = await User.findById(hold.userId).lean();
      if (user && user.email) {
        const firstName = (user.name || 'there').split(' ')[0];
        const approvalDate = new Date().toLocaleDateString('en-IN', {
          day: '2-digit', month: 'long', year: 'numeric',
        });

        let roomTypeName = '';
        if (hold.roomTypeId) {
          const RoomType = require('../../models/RoomType');
          const rt = await RoomType.findById(hold.roomTypeId).lean();
          roomTypeName = rt?.name || rt?.displayName || '';
        }

        const holdObj = hold.toObject ? hold.toObject() : hold;

        const pdfBuffer = await generateReceiptPdf({
          receiptType: 'deposit',
          user: { name: user.name, email: user.email, phone: user.phone, userId: user.userId },
          payment: holdObj,
          roomTypeName,
        });

        const html = buildDepositReceiptEmailHtml({
          firstName,
          userId: user.userId,
          depositAmount: holdObj.depositAmount || 15000,
          registrationFee: holdObj.registrationFeePaid || 0,
          totalPaid: holdObj.totalPaidAtDeposit || holdObj.depositAmount || 15000,
          paymentMode: holdObj.paymentMode,
          approvalDate,
        });

        await sendEmail({
          to: user.email,
          subject: 'Deposit Confirmed — Viramah Student Living',
          html,
          attachments: [{ filename: `Viramah-Deposit-Receipt-${user.userId}.pdf`, content: pdfBuffer }],
        });
      }
    } catch (emailErr) {
      console.error('[ApproveDeposit] Receipt email failed (non-fatal):', emailErr.message);
    }

    return success(res, { hold }, 'Deposit approved. Room is now held for the resident.');
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

// ── GET /api/admin/deposits/refund-requests ───────────────────────────────────
/**
 * List all pending refund requests. Admin sees countdown showing urgency.
 */
const listRefundRequests = async (req, res) => {
  try {
    const { status = 'requested', page = 1, limit = 20 } = req.query;

    const [records, total] = await Promise.all([
      RefundRecord.find({ status })
        .populate('userId',    'userId name email phone')
        .populate('roomHoldId')
        .populate('approvedBy', 'userId name')
        .sort({ requestedAt: 1 }) // oldest first — most urgent
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      RefundRecord.countDocuments({ status }),
    ]);

    // Attach urgency field
    const now = Date.now();
    const recordsWithUrgency = records.map((r) => {
      const hold = r.roomHoldId;
      const refundDeadline = hold?.refundDeadline ? new Date(hold.refundDeadline) : null;
      return {
        ...r,
        hoursUntilDeadline: refundDeadline
          ? Math.ceil((refundDeadline - now) / (1000 * 60 * 60))
          : null,
        isRefundWindowOpen: refundDeadline ? now < refundDeadline : false,
      };
    });

    return success(res, {
      requests: recordsWithUrgency,
      pagination: { total, page: Number(page), limit: Number(limit) },
    }, 'Refund requests retrieved.');
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

// ── PATCH /api/admin/deposits/refunds/:refundId/approve ──────────────────────
/**
 * Admin approves a refund request. Re-validates the refund deadline server-side.
 * Releases the room seat back to available pool.
 */
const approveRefund = async (req, res) => {
  try {
    const { refundId } = req.params;
    const adminId      = req.user._id;

    const refundRecord = await depositService.approveRefund(refundId, adminId);

    return success(res, { refundRecord }, 'Refund approved. Room released and ₹15,000 marked for refund.');
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

// ── PATCH /api/admin/deposits/refunds/:refundId/reject ───────────────────────
/**
 * Admin rejects a refund request.
 * Hold stays active; resident can re-request if still within window.
 */
const rejectRefund = async (req, res) => {
  try {
    const { refundId } = req.params;
    const adminId      = req.user._id;
    const { reason }   = req.body;

    const refundRecord = await depositService.rejectRefund(refundId, adminId, reason);

    return success(res, { refundRecord }, 'Refund request rejected.');
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

// ── POST /api/admin/deposits/expire-holds ────────────────────────────────────
/**
 * Manually trigger hold expiry (intended for testing; in production use cron).
 * TODO: Remove manual trigger after cron is implemented.
 */
const triggerExpireHolds = async (req, res) => {
  try {
    const count = await depositService.expireOverdueHolds();
    return success(res, { expiredCount: count }, `Expired ${count} overdue hold(s).`);
  } catch (err) {
    return error(res, err.message, err.statusCode || 500);
  }
};

module.exports = {
  listDeposits,
  getDepositStats,
  approveDeposit,
  listRefundRequests,
  approveRefund,
  rejectRefund,
  triggerExpireHolds,
};
