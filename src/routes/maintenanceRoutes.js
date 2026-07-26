const express = require("express");
const router = express.Router();
const { upload } = require("../middleware/upload");
const auth = require("../middleware/auth");
const maintenanceController = require("../controllers/maintenanceController");

// Student routes
router.post("/create", auth, upload.array("images", 3), maintenanceController.createRequest);
router.get("/student/requests", auth, maintenanceController.getStudentRequests);

// Admin routes
router.get("/admin/requests", maintenanceController.getAllRequests);
router.patch("/admin/:id/status", maintenanceController.updateRequestStatus);
router.get("/admin/stats", maintenanceController.getStats);

module.exports = router;
