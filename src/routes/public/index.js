const express = require('express');
const enquiryRoutes = require('./enquiry');
const authRoutes = require('./auth');
const onboardingRoutes = require('./onboarding');
const paymentRoutes = require('./payments');
const uploadRoutes = require('./upload');
const roomRoutes = require('./rooms');
const { success } = require('../../utils/apiResponse');

const router = express.Router();

// Health check
router.get('/health', (req, res) => {
  return success(res, {
    status: 'ok',
    timestamp: new Date().toISOString(),
  }, 'Server is running');
});

// Enquiry routes
router.use('/enquiry', enquiryRoutes);

// Resident auth (register, login, logout, me)
router.use('/auth', authRoutes);

// Resident onboarding (steps 1-4, confirm, rooms)
router.use('/onboarding', onboardingRoutes);

// Resident payments
router.use('/payments', paymentRoutes);

// Resident file uploads (documents, photos, receipts)
router.use('/upload', uploadRoutes);

// Public room types (pricing, availability — no auth required)
router.use('/rooms', roomRoutes);

module.exports = router;
