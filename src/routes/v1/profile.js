'use strict';

const express = require('express');
const { protect } = require('../../middleware/auth');
const { downloadProfile } = require('../../controllers/public/profilePdfController');

const router = express.Router();

router.get('/me.pdf', protect, downloadProfile);

module.exports = router;
