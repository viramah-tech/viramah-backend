const express        = require('express');
const authRoutes     = require('./auth');
const userRoutes     = require('./users');
const paymentRoutes  = require('./payments');
const dashboardRoutes = require('./dashboard');
const auditRoutes    = require('./audit');
const depositRoutes  = require('./deposits');

const router = express.Router();

router.use('/auth',      authRoutes);
router.use('/users',     userRoutes);
router.use('/payments',  paymentRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/audit',     auditRoutes);
router.use('/deposits',  depositRoutes);

module.exports = router;
