#!/usr/bin/env node
require("dotenv/config");

const { ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client, bucketName } = require("../src/config/s3");
const User = require("../src/models/User");
const connectDB = require("../src/config/db");
const { collectReferencedS3KeysFromUsers, findOrphanedS3Keys } = require("../src/utils/s3Cleanup");

const main = async () => {
  const dryRun = process.argv.includes("--dry-run") || process.argv.includes("dry-run");
  const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 1000);

  if (!bucketName) {
    console.error("S3 bucket is not configured.");
    process.exit(1);
  }

  await connectDB();

  const users = await User.find({}).lean();
  const referencedKeys = collectReferencedS3KeysFromUsers(users);

  const listed = [];
  let continuationToken;
  do {
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));

    for (const item of response.Contents || []) {
      listed.push(item.Key);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  const orphanedKeys = findOrphanedS3Keys(listed, referencedKeys).slice(0, limit);

  if (orphanedKeys.length === 0) {
    console.log(`No orphaned user uploads found in ${bucketName}.`);
    return;
  }

  console.log(`Found ${orphanedKeys.length} orphaned keys in ${bucketName}.`);

  if (dryRun) {
    console.log("Dry run only; no files were deleted.");
    console.log(orphanedKeys.join("\n"));
    return;
  }

  for (const key of orphanedKeys) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    console.log(`Deleted ${key}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
