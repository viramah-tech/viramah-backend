const express = require("express");
const Lead = require("../models/Lead");
const ScheduledVisit = require("../models/ScheduledVisit");

const router = express.Router();

// ----------------------------------------------------
// PUBLIC ROUTES FOR VIRAMAH MAIN WEBSITE
// ----------------------------------------------------

// Submit a new lead / contact us
router.post("/leads", async (req, res, next) => {
  try {
    const { name, email, phone, city, state, country, source } = req.body;
    const newLead = new Lead({ name, email, phone, city, state, country, source });
    await newLead.save();
    
    // In the future, send an email notification to admins/sales here
    
    res.status(201).json({ success: true, message: "Lead submitted successfully" });
  } catch (error) {
    next(error);
  }
});

// Submit a new scheduled visit
router.post("/visits", async (req, res, next) => {
  try {
    const { name, email, phone, visitDate, visitTime, guests } = req.body;
    const newVisit = new ScheduledVisit({ name, email, phone, visitDate, visitTime, guests });
    await newVisit.save();
    
    res.status(201).json({ success: true, message: "Visit scheduled successfully" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;