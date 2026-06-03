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

// Get all leads
router.get("/leads", async (req, res, next) => {
  try {
    const leads = await Lead.find().populate("assignedTo", "basicInfo.fullName").sort({ createdAt: -1 });
    res.json({ success: true, data: leads });
  } catch (error) {
    next(error);
  }
});

// Update a lead status/notes
router.put("/leads/:id", async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      { status, notes },
      { new: true }
    ).populate("assignedTo", "basicInfo.fullName");
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
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
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    res.json({ success: true, message: `Lead ${lead.name} deleted successfully` });
  } catch (error) {
    next(error);
  }
});

// ----------------------------------------------------
// 2. SCHEDULED VISITS MANAGEMENT
// ----------------------------------------------------

// Get all scheduled visits
router.get("/visits", async (req, res, next) => {
  try {
    const visits = await ScheduledVisit.find().populate("assignedSalesMember", "basicInfo.fullName").sort({ visitDate: 1 });
    res.json({ success: true, data: visits });
  } catch (error) {
    next(error);
  }
});

// Update a visit status
router.put("/visits/:id", async (req, res, next) => {
  try {
    const { status, notes, assignedSalesMember } = req.body;
    const visit = await ScheduledVisit.findByIdAndUpdate(
      req.params.id,
      { status, notes, assignedSalesMember: assignedSalesMember || null },
      { new: true }
    );
    if (!visit) return res.status(404).json({ success: false, message: "Visit not found" });
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
    const visit = await ScheduledVisit.findByIdAndDelete(req.params.id);
    if (!visit) return res.status(404).json({ success: false, message: "Visit not found" });
    res.json({ success: true, message: `Scheduled visit for ${visit.name} deleted successfully` });
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