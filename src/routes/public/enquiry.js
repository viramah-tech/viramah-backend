const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { submitEnquiry } = require('../../controllers/public/enquiryController');

const router = express.Router();

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('phone').trim().notEmpty().withMessage('Phone is required'),
    body('message').trim().notEmpty().withMessage('Message is required'),
  ],
  validate,
  submitEnquiry
);

module.exports = router;
