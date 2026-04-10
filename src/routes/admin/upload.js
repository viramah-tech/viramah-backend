const express = require('express');
const multer = require('multer');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const { success, error } = require('../../utils/apiResponse');
const { createS3Storage, getFileUrl, fileFilter } = require('../../services/s3service');

const router = express.Router();

// Multer instances with S3 storage
const uploadReceipt = multer({
  storage: createS3Storage('receipts'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter,
});

const uploadDocument = multer({
  storage: createS3Storage('documents'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

// All routes require auth
router.use(protect);

// Upload payment receipt
router.post('/receipt', authorize('admin', 'accountant'), uploadReceipt.single('receipt'), (req, res) => {
  if (!req.file) {
    return error(res, 'No file uploaded', 400);
  }
  return success(res, {
    url: getFileUrl(req.file.key),
    key: req.file.key,
    size: req.file.size,
  }, 'Receipt uploaded successfully');
});

// Upload user document
router.post('/document', authorize('admin'), uploadDocument.single('document'), (req, res) => {
  if (!req.file) {
    return error(res, 'No file uploaded', 400);
  }
  return success(res, {
    url: getFileUrl(req.file.key),
    key: req.file.key,
    size: req.file.size,
  }, 'Document uploaded successfully');
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
