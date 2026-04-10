'use strict';

const Booking = require('../models/Booking');
const { error } = require('../utils/apiResponse');

const requireBookingOwnership = async (req, res, next) => {
  try {
    const bookingId = req.params.id || req.params.bookingId;
    if (!bookingId) {
      return error(res, 'Booking id is required', 400);
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return error(res, 'Booking not found', 404);
    }

    if (String(booking.userId) !== String(req.user?._id)) {
      return error(res, 'Forbidden', 403);
    }

    req.booking = booking;
    return next();
  } catch (e) {
    return next(e);
  }
};

module.exports = {
  requireBookingOwnership,
};
