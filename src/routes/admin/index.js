const express        = require('express');
const authRoutes     = require('./auth');
const userRoutes     = require('./users');
const paymentRoutes  = require('./payments');
const dashboardRoutes = require('./dashboard');
const auditRoutes    = require('./audit');
const depositRoutes  = require('./deposits');
const uploadRoutes   = require('./upload');
const discountRoutes = require('./discount');
const paymentsV2Routes = require('./paymentsV2');
const planAdminRoutes  = require('./planAdmin');
const accountantRoutes = require('./accountant');
const pricingConfigRoutes = require('./pricingConfig');

const router = express.Router();

router.use('/auth',      authRoutes);
router.use('/users',     userRoutes);
router.use('/payments',  paymentRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/audit',     auditRoutes);
router.use('/deposits',  depositRoutes);
router.use('/upload',    uploadRoutes);
// V2 discount management (Section 4.3) — mounted at /api/admin/{discount-config,adjustments/...}
router.use('/', discountRoutes);
// V2 payment review (Section 4.4) — mounted at /api/admin/payments-v2 (legacy /payments untouched)
router.use('/payments-v2', paymentsV2Routes);
// V2 plan admin (Section 4.5) — payment-plans/* and adjustments/*
router.use('/', planAdminRoutes);
// V2 accountant dashboard (Section 4.6) — /api/admin/accountant/*
router.use('/accountant', accountantRoutes);
router.use('/', pricingConfigRoutes);

module.exports = router;

