'use strict';
const express = require('express');
const bookingRoutes = require('./bookings');
const verificationRoutes = require('./admin/verifications');

const router = express.Router();

// Resident-facing V1 routes
router.use('/bookings', bookingRoutes);

// Admin-facing V1 routes (auth enforced inside each router)
router.use('/admin/verifications', verificationRoutes);

module.exports = router;
