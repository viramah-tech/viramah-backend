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

module.exports = router;
