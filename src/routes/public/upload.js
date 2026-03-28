const express = require('express');
const multer = require('multer');
const { protect } = require('../../middleware/auth');
const { authorize } = require('../../middleware/roleAuth');
const { success, error } = require('../../utils/apiResponse');
const { createS3Storage, getFileUrl, deleteFile, fileFilter } = require('../../services/s3Service');
const User = require('../../models/User');
const Payment = require('../../models/Payment');
const RoomHold = require('../../models/RoomHold');

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

// Delete an uploaded file from S3 and clear DB references
router.delete('/file', async (req, res) => {
  try {
    const { fileUrl } = req.body;
    if (!fileUrl) return error(res, 'fileUrl is required', 400);

    // Extract S3 key from full URL
    // URL pattern: https://bucket.s3.region.amazonaws.com/KEY or https://cloudfront/KEY
    let key = fileUrl;
    try {
      const url = new URL(fileUrl);
      key = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    } catch {
      // If already just a key, use as-is
    }

    if (!key) return error(res, 'Could not extract file key', 400);

    // Security: ensure the key belongs to this user's uploads
    const userId = req.user._id.toString();
    if (!key.includes(userId) && !key.includes('anon')) {
      return error(res, 'You can only delete your own uploads', 403);
    }

    // Delete from S3
    await deleteFile(key);

    // Clear references in User model
    const user = await User.findById(req.user._id);
    if (user) {
      let userModified = false;
      if (user.documents?.idProof === fileUrl) { user.documents.idProof = ''; userModified = true; }
      if (user.documents?.addressProof === fileUrl) { user.documents.addressProof = ''; userModified = true; }
      if (user.documents?.photo === fileUrl) { user.documents.photo = ''; userModified = true; }
      if (user.parentDocuments?.idFront === fileUrl) { user.parentDocuments.idFront = ''; userModified = true; }
      if (user.parentDocuments?.idBack === fileUrl) { user.parentDocuments.idBack = ''; userModified = true; }
      if (userModified) await user.save();
    }

    // Clear references in Payment model
    await Payment.updateMany(
      { userId: req.user._id, receiptUrl: fileUrl },
      { $set: { receiptUrl: '' } }
    );

    // Clear references in RoomHold model
    await RoomHold.updateMany(
      { userId: req.user._id, depositReceiptUrl: fileUrl },
      { $set: { depositReceiptUrl: '' } }
    );

    return success(res, { deletedKey: key }, 'File deleted successfully');
  } catch (err) {
    console.error('[upload:delete]', err);
    return error(res, err.message || 'Failed to delete file', 500);
  }
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
