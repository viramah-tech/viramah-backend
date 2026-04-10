'use strict';

/**
 * installmentController.js — V2.0 Partial payment endpoints.
 *
 * Handles installment partial payments (e.g., ₹90,000 of ₹150,000).
 */

const installmentService = require('../../services/installmentService');
const { success, error } = require('../../utils/apiResponse');

// POST /api/v1/bookings/:id/installments/:installmentNumber/pay
const submitPartialPayment = async (req, res, next) => {
  try {
    const { amount, utrNumber, receiptUrl, paymentMethod } = req.body;
    const installmentNumber = parseInt(req.params.installmentNumber, 10);

    if (!amount || amount < 1000) {
      return error(res, 'Minimum payment amount is ₹1,000', 400);
    }

    const result = await installmentService.processPartialPayment(
      req.params.id,
      installmentNumber,
      Number(amount),
      paymentMethod ? { type: paymentMethod } : {},
      { fileUrl: receiptUrl, utrNumber }
    );

    return success(res, result, 'Installment payment submitted for verification', 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// GET /api/v1/bookings/:id/installments/:installmentNumber
const getInstallmentData = async (req, res, next) => {
  try {
    const installmentNumber = parseInt(req.params.installmentNumber, 10);
    const data = await installmentService.getPaymentPageData(
      req.params.id,
      installmentNumber
    );
    return success(res, data, 'Installment payment page data');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { submitPartialPayment, getInstallmentData };
