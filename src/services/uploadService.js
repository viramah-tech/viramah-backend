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

const reuploadDocuments = async (user, files) => {
  const User = require("../models/User"); // Dynamic require to avoid circular dependencies if any
  const dbUser = await User.findById(user._id);
  if (!dbUser) throw new ValidationError("User not found");

  let updated = false;

  if (files.idFront?.[0]) {
    dbUser.userIdProof.frontImage = await uploadToS3(files.idFront[0], `documents/${dbUser.basicInfo.userId}/id`);
    updated = true;
  }
  if (files.idBack?.[0]) {
    dbUser.userIdProof.backImage = await uploadToS3(files.idBack[0], `documents/${dbUser.basicInfo.userId}/id`);
    updated = true;
  }

  if (files.guardianIdFront?.[0]) {
    dbUser.guardianDetails.idProof.frontImage = await uploadToS3(files.guardianIdFront[0], `documents/${dbUser.basicInfo.userId}/guardian-id`);
    updated = true;
  }
  if (files.guardianIdBack?.[0]) {
    dbUser.guardianDetails.idProof.backImage = await uploadToS3(files.guardianIdBack[0], `documents/${dbUser.basicInfo.userId}/guardian-id`);
    updated = true;
  }

  if (updated) {
    dbUser.verification.documentVerificationStatus = "pending";
    dbUser.verification.documentRejectionReason = null;
    await dbUser.save();
  }

  return { success: true, message: "Documents updated successfully" };
};

module.exports = { uploadDocument, uploadPaymentProof, reuploadDocuments };
