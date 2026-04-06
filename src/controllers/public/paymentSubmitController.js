'use strict';

const submitService = require('../../services/paymentSubmitService');
const { success, error } = require('../../utils/apiResponse');

const submit = async (req, res, next) => {
  try {
    const result = await submitService.submitPayment(req.user._id, req.body);
    return success(res, result, 'Payment submitted', 201);
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

const history = async (req, res, next) => {
  try {
    const data = await submitService.getHistory(req.user._id, {
      page:  parseInt(req.query.page, 10)  || 1,
      limit: parseInt(req.query.limit, 10) || 20,
    });
    return success(res, data, 'Payment history');
  } catch (e) { next(e); }
};

const single = async (req, res, next) => {
  try {
    const payment = await submitService.getPaymentById(req.user._id, req.params.paymentId);
    return success(res, { payment }, 'Payment');
  } catch (e) {
    if (e.statusCode) return error(res, e.message, e.statusCode);
    next(e);
  }
};

module.exports = { submit, history, single };
