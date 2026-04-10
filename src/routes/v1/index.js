'use strict';

/**
 * v1/index.js — V2.0 Route aggregator.
 *
 * Resident-facing:
 *   /bookings/*       — booking lifecycle, installments, services, referral
 *
 * Admin-facing:
 *   /admin/verifications/*  — payment verification queue
 *   /admin/bookings/*       — booking management
 *   /admin/reconciliation/* — bank reconciliation
 *   /admin/timers/*         — timer controls (extend/reduce/pause/resume)
 *   /admin/discounts/*      — discount management (per-user, per-booking)
 */

const express = require('express');

// Resident-facing
const bookingRoutes = require('./bookings');

// Admin-facing
const verificationRoutes  = require('./admin/verifications');
const bookingMgmtRoutes   = require('./admin/bookings');
const reconciliationRoutes = require('./admin/reconciliation');
const timerRoutes          = require('./admin/timers');
const discountRoutes       = require('./admin/discounts');

const router = express.Router();

// ── Resident Routes ──────────────────────────────────────────────────────────
router.use('/bookings', bookingRoutes);

// ── Admin Routes ─────────────────────────────────────────────────────────────
router.use('/admin/verifications', verificationRoutes);
router.use('/admin/bookings', bookingMgmtRoutes);
router.use('/admin/reconciliation', reconciliationRoutes);

// V2.0: Timer control routes (mounted under /admin/bookings for RESTful nesting)
// e.g. GET /api/v1/admin/bookings/:id/timers
router.use('/admin/bookings', timerRoutes);

// V2.0: Discount management routes
// e.g. POST /api/v1/admin/discounts/users/:userId/discounts
router.use('/admin/discounts', discountRoutes);

module.exports = router;
