'use strict';

// V1 admin payment controller — read-only endpoints only.
// Write operations (create / approve / reject / receipt) live in
// controllers/admin/paymentReviewController.js (mounted at /api/admin/payments-v2).

const paymentService  = require('../../services/paymentService');
const { success, error } = require('../../utils/apiResponse');

// ── Get Payments (listing with filters) ───────────────────────────────────────

/**
 * GET /api/admin/payments
 * @access Admin, Accountant
 */
const getPayments = async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const result = await paymentService.getPayments({ page, limit, status });
    return success(res, result, 'Payments fetched successfully');
  } catch (err) {
    next(err);
  }
};

// ── Get Payment Stats ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/payments/stats
 * @access Admin, Accountant
 */
const getPaymentStats = async (req, res, next) => {
  try {
    const stats = await paymentService.getPaymentStats();
    return success(res, stats, 'Payment statistics fetched successfully');
  } catch (err) {
    next(err);
  }
};

// ── Get Payment Analytics ─────────────────────────────────────────────────────

/**
 * GET /api/admin/payments/analytics
 * @access Admin, Accountant
 */
const getPaymentAnalytics = async (req, res, next) => {
  try {
    const analytics = await paymentService.getPaymentAnalytics();
    return success(res, analytics, 'Payment analytics fetched successfully');
  } catch (err) {
    next(err);
  }
};

// ── Get Payment By ID ──────────────────────────────────────────────────────────

/**
 * GET /api/admin/payments/:id
 * @access Admin, Accountant
 */
const getPaymentById = async (req, res, next) => {
  try {
    const payment = await paymentService.getPaymentById(req.params.id);
    return success(res, payment, 'Payment fetched successfully');
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
};

// ── Export Payments ────────────────────────────────────────────────────────────

/**
 * GET /api/admin/payments/export/data
 * @access Admin, Accountant
 */
const exportPayments = async (req, res, next) => {
  try {
    const { status, startDate, endDate } = req.query;
    const payments = await paymentService.exportPayments({ status, startDate, endDate });
    return success(res, {
      payments,
      exportedAt: new Date().toISOString(),
      count:      payments.length,
    }, 'Payments exported');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPayments,
  getPaymentStats,
  getPaymentAnalytics,
  getPaymentById,
  exportPayments,
};
