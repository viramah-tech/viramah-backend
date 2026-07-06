const express = require("express");
const Lead = require("../models/Lead");
const ScheduledVisit = require("../models/ScheduledVisit");
const User = require("../models/User");
const Room = require("../models/Room");
const authenticate = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");

const router = express.Router();

// Require valid authentication and at least sales_member role
router.use(authenticate, roleGuard("admin", "sales_member"));

// ----------------------------------------------------
// 1. LEADS MANAGEMENT
// ----------------------------------------------------

// Get all leads (or only those assigned to the sales member)
router.get("/leads", async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role === "sales_member") {
      filter.assignedTo = req.user._id;
    }
    const leads = await Lead.find(filter).populate("assignedTo", "basicInfo.fullName").sort({ createdAt: -1 });
    res.json({ success: true, data: leads });
  } catch (error) {
    next(error);
  }
});

// Update a lead status/notes/agent
router.put("/leads/:id", async (req, res, next) => {
  try {
    const { status, notes, assignedTo } = req.body;

    const existingLead = await Lead.findById(req.params.id);
    if (!existingLead) return res.status(404).json({ success: false, message: "Lead not found" });

    if (req.user.role === "sales_member") {
      // Sales members can only update their own leads
      if (!existingLead.assignedTo || existingLead.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "Forbidden: You are not assigned to this lead" });
      }
      // Sales members cannot change the assigned agent of a lead
      if (assignedTo !== undefined && assignedTo !== existingLead.assignedTo.toString()) {
        return res.status(403).json({ success: false, message: "Forbidden: Only admins can reassign leads" });
      }
    }

    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo || null;

    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate("assignedTo", "basicInfo.fullName");
    
    res.json({ success: true, data: lead });
  } catch (error) {
    next(error);
  }
});

// Create a lead manually
router.post("/leads", async (req, res, next) => {
  try {
    const { name, email, phone, city, state, country, source, notes, status } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: "Name and Phone number are required" });
    }
    const newLead = new Lead({
      name,
      email: email ? email.toLowerCase().trim() : "",
      phone: phone.trim(),
      city: city || "",
      state: state || "",
      country: country || "",
      source: source || "Manual Entry",
      status: status || "New",
      notes: notes || ""
    });
    await newLead.save();
    await newLead.populate("assignedTo", "basicInfo.fullName");
    res.status(201).json({ success: true, data: newLead });
  } catch (error) {
    next(error);
  }
});

// Delete a lead manually
router.delete("/leads/:id", async (req, res, next) => {
  try {
    const existingLead = await Lead.findById(req.params.id);
    if (!existingLead) return res.status(404).json({ success: false, message: "Lead not found" });

    if (req.user.role === "sales_member") {
      if (!existingLead.assignedTo || existingLead.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "Forbidden: You can only delete leads assigned to you" });
      }
    }

    await Lead.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: `Lead ${existingLead.name} deleted successfully` });
  } catch (error) {
    next(error);
  }
});

// Bulk Upload Leads via CSV
const multer = require("multer");
const { uploadToS3 } = require("../middleware/upload");
const csvUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.mimetype === "application/vnd.ms-excel" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"), false);
    }
  },
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});

router.post("/leads/bulk-upload", csvUpload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No CSV file uploaded" });
    }

    // 1. Upload CSV to S3
    const fileUrl = await uploadToS3(req.file, "leads_imports");

    // 2. Parse CSV rows
    const csvContent = req.file.buffer.toString("utf8");
    const lines = csvContent.split(/\r?\n/);
    if (lines.length <= 1) {
      return res.status(400).json({ success: false, message: "CSV file is empty" });
    }

    // Parse headers
    const rawHeaders = lines[0].split(",");
    const headers = rawHeaders.map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));
    
    // Check required fields
    if (!headers.includes("name") || !headers.includes("phone")) {
      return res.status(400).json({ 
        success: false, 
        message: "CSV must contain at least 'name' and 'phone' column headers" 
      });
    }

    const leadsToSave = [];
    const errors = [];

    // Parse rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // skip blank lines

      // Split by commas, handling simple quotes
      let row = [];
      const matches = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
      if (matches) {
        row = matches.map(v => v.trim().replace(/^["']|["']$/g, ''));
      } else {
        row = line.split(",").map(v => v.trim().replace(/^["']|["']$/g, ''));
      }

      // Build lead object
      const leadData = {};
      headers.forEach((header, idx) => {
        leadData[header] = row[idx] || "";
      });

      if (!leadData.name || !leadData.phone) {
        errors.push({ 
          row: i + 1, 
          record: leadData, 
          error: "Missing required fields (name and phone are mandatory)" 
        });
        continue;
      }

      leadsToSave.push({
        name: leadData.name.trim(),
        phone: leadData.phone.trim(),
        email: leadData.email ? leadData.email.toLowerCase().trim() : "",
        city: leadData.city || "",
        state: leadData.state || "",
        country: leadData.country || "India",
        source: leadData.source || "CSV Import",
        notes: leadData.notes || ""
      });
    }

    // 3. Assign agents round-robin
    const mongoose = require("mongoose");
    const SalesAgent = mongoose.model("SalesAgent");
    const activeAgents = await SalesAgent.find({ accountStatus: "active" }).sort({ createdAt: 1 });
    
    if (activeAgents.length > 0 && leadsToSave.length > 0) {
      const lastLead = await Lead.findOne({ assignedTo: { $ne: null } }).sort({ createdAt: -1 });
      let agentIndex = 0;
      if (lastLead && lastLead.assignedTo) {
        const idx = activeAgents.findIndex(a => a._id.toString() === lastLead.assignedTo.toString());
        if (idx !== -1) {
          agentIndex = (idx + 1) % activeAgents.length;
        }
      }

      for (const lead of leadsToSave) {
        lead.assignedTo = activeAgents[agentIndex]._id;
        agentIndex = (agentIndex + 1) % activeAgents.length;
      }
    }

    // 4. Create leads in database
    let createdCount = 0;
    if (leadsToSave.length > 0) {
      const createdLeads = await Lead.create(leadsToSave);
      createdCount = createdLeads.length;
      
      // Log admin action
      const { logAdminAction } = require("../utils/auditLogger");
      await logAdminAction("BULK_LEADS_UPLOAD", req.user.basicInfo.userId, null, {
        fileUrl,
        processed: createdCount,
        failed: errors.length
      });
    }

    res.json({
      success: true,
      data: {
        fileUrl,
        processed: createdCount,
        failed: errors.length,
        errors: errors.slice(0, 100)
      }
    });

  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------
// 2. SCHEDULED VISITS MANAGEMENT
// ----------------------------------------------------

// Get all scheduled visits (or only those assigned to the sales member)
router.get("/visits", async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role === "sales_member") {
      filter.assignedSalesMember = req.user._id;
    }
    const visits = await ScheduledVisit.find(filter).populate("assignedSalesMember", "basicInfo.fullName").sort({ visitDate: 1 });
    res.json({ success: true, data: visits });
  } catch (error) {
    next(error);
  }
});

// Update a visit status
router.put("/visits/:id", async (req, res, next) => {
  try {
    const { status, notes, assignedSalesMember } = req.body;
    
    const existingVisit = await ScheduledVisit.findById(req.params.id);
    if (!existingVisit) return res.status(404).json({ success: false, message: "Visit not found" });

    if (req.user.role === "sales_member") {
      if (!existingVisit.assignedSalesMember || existingVisit.assignedSalesMember.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "Forbidden: You are not assigned to this visit" });
      }
      if (assignedSalesMember !== undefined && assignedSalesMember !== existingVisit.assignedSalesMember.toString()) {
        return res.status(403).json({ success: false, message: "Forbidden: Only admins can reassign visits" });
      }
    }

    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (assignedSalesMember !== undefined) updateData.assignedSalesMember = assignedSalesMember || null;

    const visit = await ScheduledVisit.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    res.json({ success: true, data: visit });
  } catch (error) {
    next(error);
  }
});

// Create a scheduled visit manually
router.post("/visits", async (req, res, next) => {
  try {
    const { name, email, phone, visitDate, visitTime, guests, notes, status, assignedSalesMember } = req.body;
    if (!name || !phone || !visitDate || !visitTime) {
      return res.status(400).json({ success: false, message: "Name, Phone, Visit Date, and Visit Time are required" });
    }
    const newVisit = new ScheduledVisit({
      name,
      email: email ? email.toLowerCase().trim() : "",
      phone: phone.trim(),
      visitDate,
      visitTime,
      guests: guests || 1,
      notes: notes || "",
      status: status || "Pending",
      assignedSalesMember: assignedSalesMember || null
    });
    await newVisit.save();
    res.status(201).json({ success: true, data: newVisit });
  } catch (error) {
    next(error);
  }
});

// Delete a scheduled visit manually
router.delete("/visits/:id", async (req, res, next) => {
  try {
    const existingVisit = await ScheduledVisit.findById(req.params.id);
    if (!existingVisit) return res.status(404).json({ success: false, message: "Visit not found" });

    if (req.user.role === "sales_member") {
      if (!existingVisit.assignedSalesMember || existingVisit.assignedSalesMember.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: "Forbidden: You can only delete visits assigned to you" });
      }
    }

    await ScheduledVisit.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: `Scheduled visit for ${existingVisit.name} deleted successfully` });
  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------
// 3. TENANT MANAGEMENT (Restricted scope for sales)
// ----------------------------------------------------

// Get a list of users/tenants - can only view, no edits (except room assignment)
router.get("/tenants", async (req, res, next) => {
  try {
    const tenants = await User.find(
      { role: { $in: ["user", "tenant"] } },
      "basicInfo.userId basicInfo.fullName basicInfo.email basicInfo.phone basicInfo.residentId roomDetails accountStatus"
    ).populate("roomDetails.roomRef");
    res.json({ success: true, data: tenants });
  } catch (error) {
    next(error);
  }
});

// View available rooms for assignment
router.get("/available-rooms", async (req, res, next) => {
  try {
    const rooms = await Room.find({ status: "Available" }).populate("roomType", "name");
    res.json({ success: true, data: rooms });
  } catch (error) {
    next(error);
  }
});

// Assign room to a tenant
router.put("/assign-room/:userId", async (req, res, next) => {
  try {
    const { roomId } = req.body;
    
    const mongoose = require("mongoose");
    const query = mongoose.Types.ObjectId.isValid(req.params.userId)
      ? { $or: [{ _id: req.params.userId }, { "basicInfo.userId": req.params.userId }] }
      : { "basicInfo.userId": req.params.userId };

    const user = await User.findOne(query);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // If already assigned to this exact room, return success immediately
    if (user.roomDetails && user.roomDetails.roomRef && user.roomDetails.roomRef.toString() === roomId) {
      return res.json({ success: true, message: "Room already assigned to this tenant" });
    }

    // Handle Unassign request
    if (roomId === "unassign") {
      if (user.roomDetails && user.roomDetails.roomRef) {
        const oldRoom = await Room.findById(user.roomDetails.roomRef);
        if (oldRoom) {
          oldRoom.currentOccupancy = Math.max(0, oldRoom.currentOccupancy - 1);
          if (oldRoom.currentOccupancy < oldRoom.capacity) {
            oldRoom.status = "Available";
          }
          await oldRoom.save();
        }
      }
      
      user.roomDetails.roomRef = undefined;
      user.roomDetails.roomNumber = undefined;
      user.roomDetails.status = "unassigned";
      user.roomDetails.allocationDate = undefined;
      
      await user.save();
      return res.json({ success: true, message: "Room unassigned successfully" });
    }

    const room = await Room.findById(roomId);
    if (!room || room.status !== "Available") {
      return res.status(400).json({ success: false, message: "Room not available" });
    }

    // Release old room occupancy if they had one
    if (user.roomDetails && user.roomDetails.roomRef) {
      const oldRoom = await Room.findById(user.roomDetails.roomRef);
      if (oldRoom) {
        oldRoom.currentOccupancy = Math.max(0, oldRoom.currentOccupancy - 1);
        if (oldRoom.currentOccupancy < oldRoom.capacity) {
          oldRoom.status = "Available";
        }
        await oldRoom.save();
      }
    }

    // Allocate new room
    user.roomDetails.roomRef = room._id;
    user.roomDetails.roomNumber = room.roomNumber;
    user.roomDetails.status = "assigned";
    user.roomDetails.allocationDate = new Date();
    
    room.currentOccupancy += 1;
    if (room.currentOccupancy >= room.capacity) {
      room.status = "Full";
    }

    await Promise.all([user.save(), room.save()]);

    res.json({ success: true, message: "Room assigned successfully" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;