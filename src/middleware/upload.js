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
  if (!bucketName) {
    throw new ValidationError(
      `S3 bucket not configured. Please set S3_BUCKET_NAME environment variable. Got: ${JSON.stringify({
        s3Bucket: process.env.S3_BUCKET_NAME,
        awsS3Bucket: process.env.AWS_S3_BUCKET,
        region: process.env.AWS_REGION,
        hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
        hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
      })}`
    );
  }
  
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new ValidationError(
      "AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables."
    );
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
