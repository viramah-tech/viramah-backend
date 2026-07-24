const express = require("express");
const router = express.Router();
const transportController = require("../controllers/transportController");
const authMiddleware = require("../middleware/auth");

// Public / Student endpoints
router.get("/stops", transportController.getAllStops);
router.get("/stops/:id", transportController.getStopById);

// Student Pass Subscription Endpoints (Authenticated)
router.post("/subscribe", authMiddleware, transportController.subscribePass);
router.post("/cancel", authMiddleware, transportController.cancelPass);

// Admin Endpoints
router.post("/stops", authMiddleware, transportController.createStop);
router.put("/stops/:id", authMiddleware, transportController.updateStop);
router.delete("/stops/:id", authMiddleware, transportController.deleteStop);
router.get("/subscribers", authMiddleware, transportController.getSubscribers);

module.exports = router;
