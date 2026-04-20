const { S3Client } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Support both S3_BUCKET_NAME and AWS_S3_BUCKET env variables
const bucketName = process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;

module.exports = { s3Client, bucketName };
