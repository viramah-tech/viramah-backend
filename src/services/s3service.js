const { DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multerS3 = require('multer-s3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { s3Client, S3_BUCKET } = require('../config/s3');

/**
 * Create a multer-s3 storage engine for a given folder prefix.
 *
 * @param {string} folder - S3 key prefix, e.g. "documents", "photos", "receipts"
 * @returns multerS3 storage instance
 */
const createS3Storage = (folder) => {
  return multerS3({
    s3: s3Client,
    bucket: S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      cb(null, {
        fieldName: file.fieldname,
        uploadedBy: req.user ? req.user._id.toString() : 'unknown',
      });
    },
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const userId = req.user ? req.user._id : 'anon';
      const key = `${folder}/${userId}-${uuidv4()}${ext}`;
      cb(null, key);
    },
  });
};

/**
 * Build the public URL for an S3 object.
 * If CloudFront is configured, use that domain. Otherwise, use the S3 URL.
 */
const getFileUrl = (key) => {
  if (process.env.AWS_CLOUDFRONT_DOMAIN) {
    return `https://${process.env.AWS_CLOUDFRONT_DOMAIN}/${key}`;
  }
  const region = process.env.AWS_REGION || 'ap-south-1';
  return `https://${S3_BUCKET}.s3.${region}.amazonaws.com/${key}`;
};

/**
 * Generate a presigned URL for temporary access to a private object.
 *
 * @param {string} key - S3 object key
 * @param {number} expiresIn - seconds until expiry (default 3600 = 1 hour)
 */
const getPresignedUrl = async (key, expiresIn = 3600) => {
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Delete a file from S3.
 *
 * @param {string} key - S3 object key (e.g. "documents/abc-123.pdf")
 */
const deleteFile = async (key) => {
  const command = new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return s3Client.send(command);
};

/**
 * File filter: allow images (JPEG, PNG, WebP) and PDFs.
 */
const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|pdf|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) return cb(null, true);
  cb(new Error('Only images (JPEG, PNG, WebP) and PDF files are allowed'));
};

module.exports = {
  createS3Storage,
  getFileUrl,
  getPresignedUrl,
  deleteFile,
  fileFilter,
};
