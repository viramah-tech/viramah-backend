'use strict';

const express = require('express');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const ctrl = require('../../controllers/admin/pricingConfigController');

const router = express.Router();
router.use(protect, authorize('admin', 'accountant'));

router.get('/pricing', ctrl.get);
router.patch('/pricing', authorize('admin'), ctrl.update);
router.post('/pricing/preview', ctrl.preview);

module.exports = router;
