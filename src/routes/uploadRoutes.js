const express = require("express");
const auth = require("../middleware/auth");
const { upload } = require("../middleware/upload");
const uploadService = require("../services/uploadService");
const { ValidationError } = require("../utils/errors");

const router = express.Router();

router.post("/document", auth, upload.single("file"), async (req, res, next) => {
  try {
    const docType = req.body.docType;
    if (!docType) throw new ValidationError("docType is required");
    const result = await uploadService.uploadDocument(
      req.user.basicInfo.userId,
      req.file,
      docType
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/payment-proof", auth, upload.single("file"), async (req, res, next) => {
  try {
    const result = await uploadService.uploadPaymentProof(req.user.basicInfo.userId, req.file);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/re-upload", auth, upload.fields([
  { name: "idFront", maxCount: 1 },
  { name: "idBack", maxCount: 1 },
  { name: "guardianIdFront", maxCount: 1 },
  { name: "guardianIdBack", maxCount: 1 },
]), async (req, res, next) => {
  try {
    // Pass to a service or handle directly
    const result = await uploadService.reuploadDocuments(req.user, req.files);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
