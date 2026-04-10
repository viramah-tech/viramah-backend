'use strict';

/**
 * servicePaymentController.js — V2.0 Standalone mess/transport payment endpoints.
 */

const servicePaymentService = require('../../services/servicePaymentService');
const { success, error } = require('../../utils/apiResponse');

// GET /api/v1/bookings/:id/services — available service payment options
const getServices = async (req, res, next) => {
  try {
    const options = await servicePaymentService.getServicePaymentOptions(req.params.id);
    return success(res, { availableServices: options }, 'Service payment options');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

// POST /api/v1/bookings/:id/services/:serviceType/pay — submit service payment
const submitServicePayment = async (req, res, next) => {
  try {
    const { serviceType } = req.params;
    const { amount, utrNumber, receiptUrl, paymentMethod } = req.body;

    if (!['mess', 'transport', 'MESS', 'TRANSPORT'].includes(serviceType)) {
      return error(res, 'Invalid service type. Must be mess or transport', 400);
    }
    if (!amount || amount < 500) {
      return error(res, 'Minimum service payment is ₹500', 400);
    }

    const result = await servicePaymentService.submitServicePayment(
      req.params.id,
      serviceType,
      Number(amount),
      { fileUrl: receiptUrl, utrNumber },
      paymentMethod ? { type: paymentMethod } : {}
    );

    return success(res, result, `${serviceType} payment submitted`, 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { getServices, submitServicePayment };
