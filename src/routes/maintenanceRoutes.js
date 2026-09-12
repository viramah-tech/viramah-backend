const express = require("express");
const router = express.Router();
const { upload } = require("../middleware/upload");
const auth = require("../middleware/auth");
const maintenanceController = require("../controllers/maintenanceController");

// Student routes
router.post("/create", auth, upload.array("images", 3), maintenanceController.createRequest);
router.get("/student/requests", auth, maintenanceController.getStudentRequests);
router.patch("/student/:id/close", auth, maintenanceController.closeStudentRequest);
router.post("/student/:id/close", auth, maintenanceController.closeStudentRequest);

// Incharge & Admin routes
const allowInchargeOrAdmin = (req, res, next) => {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "hostel_incharge")) {
    return res.status(403).json({
      success: false,
      error: { message: "Insufficient permissions", code: "FORBIDDEN" },
    });
  }
  next();
};

router.get("/admin/requests", auth, allowInchargeOrAdmin, maintenanceController.getAllRequests);
router.post("/admin/requests", auth, allowInchargeOrAdmin, upload.array("images", 3), maintenanceController.createAdminRequest);
router.patch("/admin/:id/status", auth, allowInchargeOrAdmin, maintenanceController.updateRequestStatus);
router.get("/admin/stats", auth, allowInchargeOrAdmin, maintenanceController.getStats);

module.exports = router;
