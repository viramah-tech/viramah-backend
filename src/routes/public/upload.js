const express = require('express');
const multer = require('multer');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const { success, error } = require('../../utils/apiResponse');
const { createS3Storage, getFileUrl, fileFilter } = require('../../services/s3Service');

const router = express.Router();

// Multer instances with S3 storage for each upload type
const uploadDocument = multer({
  storage: createS3Storage('documents'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter,
});

const uploadPhoto = multer({
  storage: createS3Storage('photos'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter,
});

const uploadReceipt = multer({
  storage: createS3Storage('receipts'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

// All routes require authenticated resident
router.use(protect, authorize('user'));

// Upload a document (ID proof, address proof)
router.post('/document', uploadDocument.single('document'), (req, res) => {
  if (!req.file) return error(res, 'No file uploaded', 400);
  return success(res, {
    url: getFileUrl(req.file.key),
    key: req.file.key,
    size: req.file.size,
  }, 'Document uploaded');
});

// Upload a profile photo
router.post('/photo', uploadPhoto.single('photo'), (req, res) => {
  if (!req.file) return error(res, 'No file uploaded', 400);
  return success(res, {
    url: getFileUrl(req.file.key),
    key: req.file.key,
    size: req.file.size,
  }, 'Photo uploaded');
});

// Upload a payment receipt
router.post('/receipt', uploadReceipt.single('receipt'), (req, res) => {
  if (!req.file) return error(res, 'No file uploaded', 400);
  return success(res, {
    url: getFileUrl(req.file.key),
    key: req.file.key,
    size: req.file.size,
  }, 'Receipt uploaded');
});

// Multer / S3 error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return error(res, 'File too large. Maximum size is 10MB', 400);
    }
    return error(res, err.message, 400);
  }
  if (err.message && err.message.includes('Only images')) {
    return error(res, err.message, 400);
  }
  next(err);
});

module.exports = router;
