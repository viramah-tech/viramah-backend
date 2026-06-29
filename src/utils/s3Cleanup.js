const USER_UPLOAD_PREFIXES = ["documents/", "payments/", "uploads/"];

const isUserUploadKey = (key) => {
  if (typeof key !== "string" || key.trim() === "") return false;
  return USER_UPLOAD_PREFIXES.some((prefix) => key.startsWith(prefix));
};

const normalizeS3Key = (value) => {
  if (typeof value !== "string" || value.trim() === "") return null;
  if (value.startsWith("data:")) return null;

  try {
    const parsed = new URL(value);
    const pathname = decodeURIComponent(parsed.pathname || "").replace(/^\/+/, "");
    return pathname || null;
  } catch {
    return value.trim().replace(/^\/+/, "");
  }
};

const collectReferencedS3KeysFromUsers = (users = []) => {
  const keys = new Set();

  const collectFromValue = (value) => {
    if (value == null) return;

    if (typeof value === "string") {
      const normalized = normalizeS3Key(value);
      if (normalized) {
        const lower = normalized.toLowerCase();
        if (lower.startsWith("documents/") || lower.startsWith("payments/") || lower.startsWith("uploads/")) {
          keys.add(normalized);
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(collectFromValue);
      return;
    }

    if (typeof value === "object") {
      Object.values(value).forEach(collectFromValue);
    }
  };

  for (const user of users) {
    collectFromValue(user);
  }

  return keys;
};

const splitS3KeysByReference = (objectKeys = [], referencedKeys = new Set()) => {
  const normalizedReferenced = new Set(Array.from(referencedKeys || []).map(normalizeS3Key).filter(Boolean));
  const referencedInBucket = [];
  const orphaned = [];

  for (const key of objectKeys) {
    const normalizedKey = normalizeS3Key(key);
    if (!normalizedKey || !isUserUploadKey(normalizedKey)) continue;

    if (normalizedReferenced.has(normalizedKey)) {
      referencedInBucket.push(normalizedKey);
    } else {
      orphaned.push(normalizedKey);
    }
  }

  return { referencedInBucket, orphaned };
};

const findOrphanedS3Keys = (objectKeys = [], referencedKeys = new Set()) => {
  return splitS3KeysByReference(objectKeys, referencedKeys).orphaned;
};

const getS3ErrorMessage = (error) => {
  const code = error?.name || error?.Code || "";
  const message = error?.message || "";

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return "AWS S3 credentials are not configured.";
  }

  if (code === "AccessDenied" || /AccessDenied|NotAuthorized|Forbidden/i.test(message)) {
    return "S3 access denied. Please verify the AWS credentials and bucket permissions.";
  }

  if (code === "NoSuchBucket" || /NoSuchBucket/i.test(message)) {
    return "The configured S3 bucket could not be found.";
  }

  if (code === "InvalidAccessKeyId" || /InvalidAccessKeyId/i.test(message)) {
    return "The configured AWS access key is invalid.";
  }

  if (code === "ExpiredToken" || /ExpiredToken/i.test(message)) {
    return "The AWS session token has expired.";
  }

  return `Unable to access S3: ${message || code || "Unknown S3 error"}`;
};

module.exports = {
  USER_UPLOAD_PREFIXES,
  isUserUploadKey,
  collectReferencedS3KeysFromUsers,
  splitS3KeysByReference,
  findOrphanedS3Keys,
  getS3ErrorMessage,
};
