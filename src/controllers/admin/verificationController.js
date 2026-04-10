'use strict';

/**
 * verificationController.js — V2.0 Admin payment verification endpoints.
 *
 * Handles approval/rejection for ALL payment types:
 * - BOOKING payments → approveBookingPayment (7-day timer start)
 * - INSTALLMENT payments → onPartialPaymentApproved (recalculate installment)
 * - MESS/TRANSPORT payments → onServicePaymentApproved (update service status)
 */

const paymentReviewService = require('../../services/payment-review-service');
const installmentService   = require('../../services/installment-service');
const servicePaymentService = require('../../services/service-payment-service');
const Payment = require('../../models/Payment');
const { success, error } = require('../../utils/apiResponse');

const actorFromReq = (req) => ({
  userId: req.user?._id,
  name:   req.user?.name || '',
  role:   req.user?.role || '',
});

// GET /api/v1/admin/verifications — list pending queue
const list = async (req, res, next) => {
  try {
    const data = await paymentReviewService.listPayments({
      status:      req.query.status || 'pending',
      paymentType: req.query.paymentType,
      userId:      req.query.userId,
      riskLevel:   req.query.riskLevel,
      page:  parseInt(req.query.page, 10)  || 1,
      limit: parseInt(req.query.limit, 10) || 20,
    });
    return success(res, data, 'Verification queue');
  } catch (e) { next(e); }
};

// GET /api/v1/admin/verifications/stats
const stats = async (req, res, next) => {
  try {
    const data = await paymentReviewService.getUnifiedStats();
    return success(res, data, 'Verification queue statistics');
  } catch (e) { next(e); }
};

// GET /api/v1/admin/verifications/:id
const detail = async (req, res, next) => {
  try {
    const data = await paymentReviewService.getPaymentDetail(req.params.id);
    return success(res, data, 'Verification detail');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

/**
 * POST /api/v1/admin/verifications/:id/approve
 *
 * Smart approval — routes to the correct handler based on payment type:
 *  - BOOKING → paymentReviewService.approveBookingPayment (ledger + 7-day timer)
 *  - INSTALLMENT → installmentService.onPartialPaymentApproved (recalculates)
 *  - MESS/TRANSPORT → servicePaymentService.onServicePaymentApproved
 *  - Other → paymentReviewService.approvePayment (legacy 9-step)
 */
const approveBooking = async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return error(res, 'Payment not found', 404);

    let result;
    const actor = actorFromReq(req);

    switch (payment.type) {
      case 'BOOKING':
        result = await paymentReviewService.approveBookingPayment(req.params.id, actor);
        return success(res, result, 'Booking payment approved — 7-day final payment window started');

      case 'INSTALLMENT':
        // First approve the payment record
        payment.status = 'approved';
        payment.reviewedBy = actor;
        payment.reviewedAt = new Date();
        payment.completedAt = new Date();
        payment.adminActions.push({
          action: 'APPROVE',
          adminId: actor.userId?.toString(),
          adminName: actor.name,
          timestamp: new Date(),
          previousStatus: 'pending',
          newStatus: 'approved',
        });
        await payment.save();

        // Then process installment-specific logic
        result = await installmentService.onPartialPaymentApproved(req.params.id);
        return success(res, result, 'Installment payment approved');

      case 'MESS':
      case 'TRANSPORT':
        // First approve the payment record
        payment.status = 'approved';
        payment.reviewedBy = actor;
        payment.reviewedAt = new Date();
        payment.completedAt = new Date();
        payment.adminActions.push({
          action: 'APPROVE',
          adminId: actor.userId?.toString(),
          adminName: actor.name,
          timestamp: new Date(),
          previousStatus: 'pending',
          newStatus: 'approved',
        });
        await payment.save();

        // Then process service-specific logic
        result = await servicePaymentService.onServicePaymentApproved(req.params.id);
        return success(res, result, `${payment.type} payment approved`);

      default:
        // Legacy: full 9-step approval flow
        result = await paymentReviewService.approvePayment(req.params.id, actor);
        return success(res, result, 'Payment approved');
    }
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/admin/verifications/:id/reject
const reject = async (req, res, next) => {
  try {
    const result = await paymentReviewService.rejectPayment(req.params.id, {
      reason: req.body.reason,
      actor:  actorFromReq(req),
    });
    return success(res, result, 'Verification rejected');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/admin/verifications/:id/hold
const hold = async (req, res, next) => {
  try {
    const result = await paymentReviewService.holdPayment(req.params.id, {
      reason: req.body.reason,
      actor:  actorFromReq(req),
    });
    return success(res, result, 'Verification placed on hold');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { list, detail, approveBooking, reject, hold, stats };
