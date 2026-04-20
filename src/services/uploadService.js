const { uploadToS3 } = require("../middleware/upload");
const { ValidationError } = require("../utils/errors");

const ALLOWED_DOC_TYPES = ["id_front", "id_back", "guardian_id_front", "guardian_id_back", "profile_photo"];

const uploadDocument = async (userId, file, docType) => {
  if (!file) throw new ValidationError("File is required");
  if (!ALLOWED_DOC_TYPES.includes(docType)) {
    throw new ValidationError(`docType must be one of ${ALLOWED_DOC_TYPES.join(", ")}`);
  }
  const url = await uploadToS3(file, `documents/${userId}/${docType}`);
  return { url };
};

const uploadPaymentProof = async (userId, file) => {
  if (!file) throw new ValidationError("File is required");
  const url = await uploadToS3(file, `payments/${userId}`);
  return { url };
};

module.exports = { uploadDocument, uploadPaymentProof };
