const multer = require("multer");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client, bucketName } = require("../config/s3");
const { v4: uuidv4 } = require("uuid");
const { ValidationError } = require("../utils/errors");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ValidationError("Only JPEG, PNG, WebP, and PDF files are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadToS3 = async (file, folder) => {
  if (!bucketName || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.warn("[UPLOAD] S3 not configured; falling back to data URL for", folder);
    const mime = file.mimetype || "application/octet-stream";
    const base64 = file.buffer.toString("base64");
    return `data:${mime};base64,${base64}`;
  }
  
  const safeName = (file.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${folder}/${uuidv4()}-${safeName}`;
  
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );
  } catch (error) {
    throw new ValidationError(`S3 upload failed: ${error.message}`);
  }
  
  const region = process.env.AWS_REGION || "ap-south-1";
  return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
};

module.exports = { upload, uploadToS3 };
