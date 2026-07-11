const express = require("express");
const Joi = require("joi");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const validate = require("../middleware/validate");
const adminService = require("../services/adminService");
const { logAdminAction } = require("../utils/auditLogger");
const { collectReferencedS3KeysFromUsers, splitS3KeysByReference, getS3ErrorMessage } = require("../utils/s3Cleanup");

const router = express.Router();

// Apply authentication to ALL routes
router.use(auth);

// Apply dynamic role verification (allowing sales_member/accountant to read users/rooms/payments and manage relevant items)
router.use((req, res, next) => {
  const isReadOnlyRoute = req.method === "GET" && (
    req.path === "/users" ||
    req.path.startsWith("/users/") ||
    req.path === "/rooms" ||
    req.path.startsWith("/rooms/") ||
    req.path === "/sales-team" ||
    req.path === "/payments" ||
    req.path === "/dashboard"
  );
  
  // Allow sales to manage rooms (POST /rooms, DELETE /rooms/:id)
  const isSalesRoomAction = (req.method === "POST" || req.method === "DELETE") && (
    req.path === "/rooms" ||
    req.path.startsWith("/rooms/")
  );

  // Allow sales to save notes (PUT /users/:userId/notes)
  const isSalesNoteAction = req.method === "PUT" && req.path.endsWith("/notes");

  // Allow accountant to approve/reject payments
  const isPaymentAction = req.method === "PUT" && 
    req.path.startsWith("/payments/") && 
    (req.path.endsWith("/approve") || req.path.endsWith("/reject"));

  // Allow accountant and admin to manage fines (POST /users/:userId/fines, DELETE /users/:userId/fines/:fineId, POST /fines/apply-daily)
  const isFineAction = req.path.includes("/fines") || req.path.endsWith("/fines");
  
  let allowedRoles = ["admin"];
  if (isReadOnlyRoute) {
    allowedRoles = ["admin", "sales_member", "accountant"];
  } else if (isSalesRoomAction || isSalesNoteAction) {
    allowedRoles = ["admin", "sales_member"];
  } else if (isPaymentAction || isFineAction) {
    allowedRoles = ["admin", "accountant"];
  }

  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: { message: "Insufficient permissions", code: "FORBIDDEN" },
    });
  }
  next();
});

const rejectSchema = Joi.object({ reason: Joi.string().min(3).max(500).required() });

const pricingSchema = Joi.object({
  tenureMonths: Joi.number().integer().min(1).max(60),
  registrationFee: Joi.number().integer().min(0),
  securityDeposit: Joi.number().integer().min(0),
  mess: Joi.object({
    monthlyFee: Joi.number().integer().min(0),
    annualDiscountedPrice: Joi.number().integer().min(0),
  }),
  transport: Joi.object({
    monthlyFee: Joi.number().integer().min(0),
  }),
  bookingPayment: Joi.object({
    minimumAmount: Joi.number().integer().min(0),
    suggestedAmount: Joi.number().integer().min(0),
  }),
  paymentDeadlineDays: Joi.number().integer().min(1).max(365),
  defaultFullPaymentDiscountPct: Joi.number().min(0).max(100),
  defaultHalfPaymentDiscountPct: Joi.number().min(0).max(100),
}).min(1);

const roomTypeSchema = Joi.object({
  name: Joi.string().valid("Axis+", "Axis", "Collective", "Nexus").required(),
  capacity: Joi.number().integer().min(1).required(),
  features: Joi.array().items(Joi.string()).default([]),
  basePrice: Joi.number().integer().min(0).required(),
  totalRooms: Joi.number().integer().min(0).default(0),
  availableRooms: Joi.number().integer().min(0).default(0),
  isActive: Joi.boolean().default(true),
});

const roomTypeUpdateSchema = roomTypeSchema.fork(Object.keys(roomTypeSchema.describe().keys), (s) =>
  s.optional()
);

const roomSchema = Joi.object({
  roomNumber: Joi.string().required(),
  roomType: Joi.string().custom((value, helpers) => {
    if (!require('mongoose').Types.ObjectId.isValid(value)) return helpers.error('any.invalid');
    return value;
  }).required(),
  floor: Joi.number().integer().required(),
  capacity: Joi.number().integer().min(1).required(),
});

router.post("/rooms", validate(roomSchema), async (req, res, next) => {
  try {
    const Room = require("../models/Room");
    const RoomType = require("../models/RoomType");
    const { roomNumber, roomType, floor } = req.validatedBody;
    
    const existing = await Room.findOne({ roomNumber });
    if (existing) {
      return res.status(400).json({ success: false, message: "Room number already exists" });
    }

    const typeDoc = await RoomType.findById(roomType);
    if (!typeDoc) {
      return res.status(400).json({ success: false, message: "Invalid Room Type selected" });
    }

    // Force capacity based on selected room type
    let finalCapacity = typeDoc.capacity || 1;
    if (typeDoc.name === "Axis+") finalCapacity = 1;
    else if (typeDoc.name === "Axis") finalCapacity = 2;
    else if (typeDoc.name === "Collective") finalCapacity = 3;
    else if (typeDoc.name === "Nexus") finalCapacity = 4;

    const room = new Room({ roomNumber, roomType, floor, capacity: finalCapacity, currentOccupancy: 0, status: "Available" });
    await room.save();
    res.status(201).json({ success: true, data: { room } });
  } catch (err) {
    next(err);
  }
});

router.get("/users", async (req, res, next) => {
  try {
    const { status, step, search, page, limit } = req.query;
    const result = await adminService.getUsers({ status, step, search, page, limit });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Must be before /users/:userId to avoid :userId capturing "export"
router.get("/users/export", async (req, res, next) => {
  try {
    const result = await adminService.getUsers({ page: 1, limit: 1000 });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/users/:userId/status",
  validate(Joi.object({ status: Joi.string().valid("pending", "active", "suspended", "blocked").required() })),
  async (req, res, next) => {
    try {
      const result = await adminService.updateUserStatus(req.params.userId, req.validatedBody.status);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.put("/users/:userId/verify-documents", async (req, res, next) => {
  try {
    const result = await adminService.verifyUserDocuments(req.params.userId, req.user.basicInfo.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/users/:userId/reject-documents",
  validate(Joi.object({ reason: Joi.string().min(3).max(500).required() })),
  async (req, res, next) => {
    try {
      const result = await adminService.rejectUserDocuments(
        req.params.userId,
        req.user.basicInfo.userId,
        req.validatedBody.reason
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.put("/users/:userId/move-in", async (req, res, next) => {
  try {
    const result = await adminService.completeMoveIn(req.params.userId, req.user.basicInfo.userId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get("/users/:userId", async (req, res, next) => {
  try {
    const user = await adminService.getUserById(req.params.userId);
    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:userId", async (req, res, next) => {
  try {
    await adminService.deleteUser(req.params.userId, req.user.basicInfo.userId);
    res.json({ success: true, message: "User deleted successfully" });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/users/:userId/discounts",
  validate(
    Joi.object({
      fullPaymentDiscountPct: Joi.number().min(0).max(100),
      halfPaymentDiscountPct: Joi.number().min(0).max(100),
      customRackRate: Joi.number().min(0),
      appliedRoomRent: Joi.number().min(0),
    }).min(1)
  ),
  async (req, res, next) => {
    try {
      const { fullPaymentDiscountPct, halfPaymentDiscountPct, customRackRate, appliedRoomRent } = req.validatedBody;
      const roomRent = await adminService.updateRoomRentDiscounts(
        req.params.userId,
        fullPaymentDiscountPct,
        halfPaymentDiscountPct,
        customRackRate,
        appliedRoomRent
      );
      res.json({ success: true, data: { roomRent } });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  "/users/:userId/notes",
  validate(Joi.object({ note: Joi.string().min(1).max(1000).required() })),
  async (req, res, next) => {
    try {
      const User = require("../models/User");
      const user = await User.findOne({ "basicInfo.userId": req.params.userId });
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      
      if (!user.admin) user.admin = {};
      if (!user.admin.notes) user.admin.notes = [];
      
      const newNote = {
        text: req.validatedBody.note,
        addedBy: req.user.basicInfo.fullName || "Sales Agent",
        addedAt: new Date(),
      };
      
      user.admin.notes.push(JSON.stringify(newNote));
      await user.save();
      
      res.json({ success: true, data: { notes: user.admin.notes } });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/payments", async (req, res, next) => {
  try {
    const { status } = req.query;
    const payments = await adminService.getPayments(status);
    res.json({ success: true, data: { payments } });
  } catch (err) {
    next(err);
  }
});

router.put("/payments/:userId/:paymentId/approve", async (req, res, next) => {
  try {
    const result = await adminService.approvePayment(
      req.params.userId,
      req.params.paymentId,
      req.user.basicInfo.userId
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/payments/:userId/:paymentId/reject",
  validate(rejectSchema),
  async (req, res, next) => {
    try {
      const result = await adminService.rejectPayment(
        req.params.userId,
        req.params.paymentId,
        req.user.basicInfo.userId,
        req.validatedBody.reason
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/dashboard", async (req, res, next) => {
  try {
    const stats = await adminService.getDashboard();
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

router.get("/audit-logs", async (req, res, next) => {
  try {
    const AuditLog = require("../models/AuditLog");
    const { eventType, search, page = 1, limit = 20 } = req.query;

    const query = {};
    if (eventType) {
      query.eventType = eventType.toUpperCase();
    }

    if (search) {
      const searchRegex = new RegExp(search, "i");
      query.$or = [
        { "performedBy.fullName": searchRegex },
        { "performedBy.userId": searchRegex },
        { "target.targetId": searchRegex },
        { "target.targetName": searchRegex },
        { action: searchRegex }
      ];
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AuditLog.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

router.put("/pricing", validate(pricingSchema), async (req, res, next) => {
  try {
    const pricing = await adminService.updatePricing(req.validatedBody);
    res.json({ success: true, data: { pricing } });
  } catch (err) {
    next(err);
  }
});

router.post("/room-types", validate(roomTypeSchema), async (req, res, next) => {
  try {
    const room = await adminService.createRoomType(req.validatedBody);
    res.status(201).json({ success: true, data: { room } });
  } catch (err) {
    next(err);
  }
});

router.put("/room-types/:id", validate(roomTypeUpdateSchema), async (req, res, next) => {
  try {
    const room = await adminService.updateRoomType(req.params.id, req.validatedBody);
    res.json({ success: true, data: { room } });
  } catch (err) {
    next(err);
  }
});

const userDetailsSchema = Joi.object({
  basicInfo: Joi.object({
    fullName: Joi.string().min(2).max(120),
    phone: Joi.string().pattern(/^[0-9+\- ]{7,15}$/).allow("", null),
    gender: Joi.string().valid("male", "female", "other", null),
    dateOfBirth: Joi.date().iso().allow(null),
    address: Joi.string().min(10).max(500).allow("", null),
    residentId: Joi.string().allow("", null),
  }),
  guardian: Joi.object({
    fullName: Joi.string().min(2).max(120).allow("", null),
    relation: Joi.string().min(2).max(40).allow("", null),
    phone: Joi.string().pattern(/^[0-9+\- ]{7,15}$/).allow("", null),
    alternatePhone: Joi.string().pattern(/^[0-9+\- ]{7,15}$/).allow("", null),
  }),
  disableAutoFines: Joi.boolean(),
}).min(1);

router.put("/users/:userId/details", validate(userDetailsSchema), async (req, res, next) => {
  try {
    const user = await adminService.updateUserDetails(req.params.userId, req.validatedBody, req.user.basicInfo.userId);
    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

const passwordChangeSchema = Joi.object({
  password: Joi.string().min(6).max(100).required(),
});

router.put(
  "/users/:userId/password",
  validate(passwordChangeSchema),
  async (req, res, next) => {
    try {
      const result = await adminService.changeUserPassword(
        req.params.userId,
        req.validatedBody.password,
        req.user.basicInfo.userId
      );
      res.json({ success: true, message: "User password updated successfully", data: result });
    } catch (err) {
      next(err);
    }
  }
);


// ----------------------------------------------------
// SALES TEAM MANAGEMENT
// ----------------------------------------------------

const salesTeamSchema = Joi.object({
  fullName: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().required(),
  password: Joi.string().min(6).required(),
});

router.post("/sales-team", validate(salesTeamSchema), async (req, res, next) => {
  try {
    const { fullName, email, phone, password } = req.validatedBody;
    const bcrypt = require("bcrypt");
    const User = require("../models/User");
    const SalesAgent = require("../models/SalesAgent");
    
    // Check if email already exists in User or SalesAgent collections
    const existingUser = await User.findOne({ "basicInfo.email": email.toLowerCase() });
    const existingAgent = await SalesAgent.findOne({ "basicInfo.email": email.toLowerCase() });
    if (existingUser || existingAgent) {
      return res.status(400).json({ success: false, message: "User with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = `SALES_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    const newSalesMember = new SalesAgent({
      basicInfo: { userId, fullName, email: email.toLowerCase(), phone },
      auth: { passwordHash },
      role: "sales_member",
      accountStatus: "active"
    });

    await newSalesMember.save();
    res.status(201).json({ success: true, data: { userId, fullName, email, role: "sales_member" } });
  } catch (err) {
    next(err);
  }
});

router.get("/sales-team", async (req, res, next) => {
  try {
    const SalesAgent = require("../models/SalesAgent");
    const team = await SalesAgent.find({}, "basicInfo.userId basicInfo.fullName basicInfo.email basicInfo.phone accountStatus createdAt");
    res.json({ success: true, data: team });
  } catch (err) {
    next(err);
  }
});

const salesTeamUpdateSchema = Joi.object({
  fullName: Joi.string().optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().optional(),
  password: Joi.string().min(6).optional().allow(""),
}).min(1);

router.put("/sales-team/:userId", validate(salesTeamUpdateSchema), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { fullName, email, phone, password } = req.validatedBody;
    const User = require("../models/User");
    const SalesAgent = require("../models/SalesAgent");
    const bcrypt = require("bcrypt");

    // Find sales agent (supporting lookup by custom userId OR MongoDB ObjectId)
    const mongoose = require("mongoose");
    const query = mongoose.Types.ObjectId.isValid(userId)
      ? { $or: [{ _id: userId }, { "basicInfo.userId": userId }] }
      : { "basicInfo.userId": userId };

    const agent = await SalesAgent.findOne(query);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Sales agent not found" });
    }

    // Check email duplication in both collections if email changed
    if (email && email.toLowerCase() !== agent.basicInfo.email.toLowerCase()) {
      const existingUser = await User.findOne({ "basicInfo.email": email.toLowerCase() });
      const existingAgent = await SalesAgent.findOne({ "basicInfo.email": email.toLowerCase() });
      if (existingUser || existingAgent) {
        return res.status(400).json({ success: false, message: "User with this email already exists" });
      }
      agent.basicInfo.email = email.toLowerCase();
    }

    if (fullName) agent.basicInfo.fullName = fullName;
    if (phone) agent.basicInfo.phone = phone;

    if (password && password.trim() !== "") {
      agent.auth.passwordHash = await bcrypt.hash(password, 10);
    }

    await agent.save();
    
    res.json({
      success: true,
      data: {
        userId: agent.basicInfo.userId,
        fullName: agent.basicInfo.fullName,
        email: agent.basicInfo.email,
        role: agent.role,
      },
    });
  } catch (err) {
    next(err);
  }
});
// ----------------------------------------------------

// Delete a sales team member
router.delete('/sales-team/:userId', async (req, res, next) => {
  try {
    const mongoose = require('mongoose');
    const query = mongoose.Types.ObjectId.isValid(req.params.userId)
      ? { $or: [{ _id: req.params.userId }, { 'basicInfo.userId': req.params.userId }] }
      : { 'basicInfo.userId': req.params.userId };
    const SalesAgent = require('../models/SalesAgent');
    const agent = await SalesAgent.findOne(query);
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Sales agent not found' });
    }
    await SalesAgent.deleteOne(query);
    await logAdminAction(req.user.basicInfo.userId, `Deleted sales agent ${agent.basicInfo.userId}`);
    res.json({ success: true, message: 'Sales agent removed' });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// ----------------------------------------------------
// PHYSICAL ROOM MANAGEMENT
// ----------------------------------------------------

const physicalRoomSchema = Joi.object({
  roomNumber: Joi.string().required(),
  capacity: Joi.number().integer().min(1).required(),
  roomType: Joi.string().required() // ObjectId string
});

router.post("/rooms", validate(physicalRoomSchema), async (req, res, next) => {
  try {
    const Room = require("../models/Room");
    const RoomType = require("../models/RoomType");
    const { roomNumber, roomType } = req.validatedBody;
    
    const existing = await Room.findOne({ roomNumber });
    if (existing) {
      return res.status(400).json({ success: false, message: "Room number already exists" });
    }

    const typeDoc = await RoomType.findById(roomType);
    if (!typeDoc) {
      return res.status(400).json({ success: false, message: "Invalid Room Type selected" });
    }

    // Force capacity based on selected room type
    let finalCapacity = typeDoc.capacity || 1;
    if (typeDoc.name === "Axis+") finalCapacity = 1;
    else if (typeDoc.name === "Axis") finalCapacity = 2;
    else if (typeDoc.name === "Collective") finalCapacity = 3;
    else if (typeDoc.name === "Nexus") finalCapacity = 4;

    const newRoom = new Room({ roomNumber, capacity: finalCapacity, roomType });
    await newRoom.save();
    
    res.status(201).json({ success: true, data: newRoom });
  } catch (err) {
    next(err);
  }
});

router.get("/rooms", async (req, res, next) => {
  try {
    const Room = require("../models/Room");
    const User = require("../models/User");
    
    const rooms = await Room.find().populate("roomType", "name capacity");
    
    // Dynamically calculate occupancy based on count of active users in the User collection
    const updatedRooms = await Promise.all(
      rooms.map(async (room) => {
        // Fetch active occupants reference by roomRef OR by matching roomNumber string
        const activeOccupants = await User.find({
          $or: [
            { "roomDetails.roomRef": room._id },
            { "roomDetails.roomNumber": room.roomNumber }
          ],
          role: { $in: ["user", "tenant"] },
          accountStatus: "active"
        }, "basicInfo.userId basicInfo.fullName basicInfo.email basicInfo.phone");

        const roomObj = room.toObject();
        roomObj.currentOccupancy = activeOccupants.length;
        
        // Map occupants to simple list
        roomObj.occupants = activeOccupants.map(occ => ({
          userId: occ.basicInfo.userId,
          fullName: occ.basicInfo.fullName,
          email: occ.basicInfo.email,
          phone: occ.basicInfo.phone
        }));

        if (activeOccupants.length >= room.capacity) {
          roomObj.status = "Full";
        } else {
          roomObj.status = "Available";
        }
        
        return roomObj;
      })
    );
    
    res.json({ success: true, data: updatedRooms });
  } catch (err) {
    next(err);
  }
});

// Delete a physical room (with occupancy check)
router.delete("/rooms/:id", async (req, res, next) => {
  try {
    const Room = require("../models/Room");
    const User = require("../models/User");
    
    const room = await Room.findById(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    // Check if there are any active occupants referencing this room's _id or roomNumber
    const activeOccupants = await User.countDocuments({
      $or: [
        { "roomDetails.roomRef": room._id },
        { "roomDetails.roomNumber": room.roomNumber }
      ],
      role: { $in: ["user", "tenant"] },
      accountStatus: "active"
    });

    if (activeOccupants > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Room ${room.roomNumber} because it currently has ${activeOccupants} active occupant(s).`
      });
    }

    await Room.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: `Room ${room.roomNumber} deleted successfully` });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// S3 DATA MANAGEMENT
// ----------------------------------------------------
router.get("/s3/objects", roleGuard("admin"), async (req, res, next) => {
  try {
    const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
    const { s3Client, bucketName } = require("../config/s3");

    if (!bucketName) {
      return res.status(400).json({ success: false, message: "S3 Bucket is not configured" });
    }

    let objects = [];
    try {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
      });
      const data = await s3Client.send(command);
      objects = (data.Contents || []).map((item) => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
        url: `https://${bucketName}.s3.${process.env.AWS_REGION || "ap-south-1"}.amazonaws.com/${item.Key}`,
      }));
    } catch (s3Err) {
      console.warn("[S3] Direct bucket listing failed, falling back to Database aggregation:", s3Err.message);
      
      const User = require("../models/User");
      const users = await User.find({}, {
        profilePhoto: 1,
        userIdProof: 1,
        guardianDetails: 1,
        paymentDetails: 1,
        createdAt: 1,
        updatedAt: 1
      }).lean();

      const parseS3Url = (url) => {
        if (!url || typeof url !== 'string') return null;
        try {
          const parsed = new URL(url);
          if (parsed.hostname.includes('.amazonaws.com')) {
            return decodeURIComponent(parsed.pathname.slice(1));
          }
        } catch (e) {}
        return null;
      };

      const objectsMap = new Map();
      const addUrl = (url, fallbackDate) => {
        if (!url) return;
        const key = parseS3Url(url);
        if (key) {
          if (!objectsMap.has(key)) {
            objectsMap.set(key, {
              key,
              size: 256 * 1024, // 256 KB fallback size
              lastModified: fallbackDate || new Date(),
              url: url,
            });
          }
        }
      };

      users.forEach(user => {
        const userDate = user.updatedAt || user.createdAt || new Date();
        addUrl(user.profilePhoto?.url, user.profilePhoto?.uploadedAt || userDate);
        addUrl(user.userIdProof?.frontImage, userDate);
        addUrl(user.userIdProof?.backImage, userDate);
        addUrl(user.guardianDetails?.idProof?.frontImage, userDate);
        addUrl(user.guardianDetails?.idProof?.backImage, userDate);

        if (user.paymentDetails && Array.isArray(user.paymentDetails)) {
          user.paymentDetails.forEach(payment => {
            addUrl(payment.proof?.url, payment.proof?.uploadedAt || payment.paidAt || userDate);
          });
        }
      });

      objects = Array.from(objectsMap.values());
    }

    res.json({ success: true, data: { objects } });
  } catch (err) {
    next(err);
  }
});

router.post("/s3/cleanup-orphans", roleGuard("admin"), async (req, res, next) => {
  try {
    const { DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
    const { s3Client, bucketName } = require("../config/s3");
    const User = require("../models/User");
    const previewOnly = req.body?.previewOnly === true || req.query?.previewOnly === "true";

    if (!bucketName) {
      return res.status(400).json({ success: false, message: "S3 Bucket is not configured" });
    }

    const users = await User.find({}).lean();
    const referencedKeys = collectReferencedS3KeysFromUsers(users);

    let objectKeys = [];
    let continuationToken;
    try {
      do {
        const response = await s3Client.send(new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }));
        objectKeys = objectKeys.concat((response.Contents || []).map((item) => item.Key));
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch (s3Error) {
      return res.status(502).json({
        success: false,
        message: getS3ErrorMessage(s3Error),
        error: { message: getS3ErrorMessage(s3Error), code: "S3_LIST_FAILED" },
      });
    }

    const { referencedInBucket, orphaned } = splitS3KeysByReference(objectKeys, referencedKeys);
    const orphanedKeys = orphaned;
    const deletedKeys = [];

    if (!previewOnly) {
      try {
        for (const key of orphanedKeys) {
          await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
          deletedKeys.push(key);
        }
      } catch (s3Error) {
        return res.status(502).json({
          success: false,
          message: getS3ErrorMessage(s3Error),
          error: { message: getS3ErrorMessage(s3Error), code: "S3_DELETE_FAILED" },
        });
      }
    }

    const count = previewOnly ? orphanedKeys.length : deletedKeys.length;

    await logAdminAction("S3 orphan cleanup", req.user.basicInfo.userId, null, {
      previewOnly,
      orphanCount: orphanedKeys.length,
      deletedCount: deletedKeys.length,
      referencedCount: referencedInBucket.length,
    });

    res.json({
      success: true,
      data: {
        deletedKeys: previewOnly ? [] : deletedKeys,
        count,
        previewOnly,
        orphanedKeys,
        orphanCount: orphanedKeys.length,
        deletedCount: deletedKeys.length,
        referencedCount: referencedInBucket.length,
        skippedReferencedCount: referencedInBucket.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/s3/objects", roleGuard("admin"), validate(Joi.object({ key: Joi.string().required() })), async (req, res, next) => {
  try {
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const { s3Client, bucketName } = require("../config/s3");
    const { key } = req.validatedBody;

    if (!bucketName) {
      return res.status(400).json({ success: false, message: "S3 Bucket is not configured" });
    }

    // Attempt to delete physical object from AWS S3
    try {
      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });
      await s3Client.send(command);
    } catch (s3Err) {
      console.warn(`[S3] Direct file deletion failed for ${key}:`, s3Err.message);
    }

    // Clean up all matching document references in MongoDB User collection
    const User = require("../models/User");
    const region = process.env.AWS_REGION || "ap-south-1";
    const url1 = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
    const url2 = `https://${bucketName}.s3.amazonaws.com/${key}`;
    const targetUrls = [url1, url2];

    await User.updateMany({ "profilePhoto.url": { $in: targetUrls } }, { $set: { "profilePhoto.url": null } });
    await User.updateMany({ "userIdProof.frontImage": { $in: targetUrls } }, { $set: { "userIdProof.frontImage": null } });
    await User.updateMany({ "userIdProof.backImage": { $in: targetUrls } }, { $set: { "userIdProof.backImage": null } });
    await User.updateMany({ "guardianDetails.idProof.frontImage": { $in: targetUrls } }, { $set: { "guardianDetails.idProof.frontImage": null } });
    await User.updateMany({ "guardianDetails.idProof.backImage": { $in: targetUrls } }, { $set: { "guardianDetails.idProof.backImage": null } });
    await User.updateMany(
      { "paymentDetails.proof.url": { $in: targetUrls } },
      { $set: { "paymentDetails.$[elem].proof.url": null } },
      { arrayFilters: [{ "elem.proof.url": { $in: targetUrls } }] }
    );

    await logAdminAction("DELETE_S3_FILE", req.user.basicInfo.userId, null, { key });

    res.json({ success: true, message: `File ${key} deleted successfully` });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/users/:userId/fines",
  validate(Joi.object({
    amount: Joi.number().integer().min(1).required(),
    reason: Joi.string().min(3).max(500).required()
  })),
  async (req, res, next) => {
    try {
      const result = await adminService.addFine(
        req.params.userId,
        req.validatedBody.amount,
        req.validatedBody.reason,
        req.user.basicInfo.userId
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// IMPORTANT: /fines/all must be registered BEFORE /fines/:fineId
// otherwise Express matches "all" as a :fineId parameter.
router.delete(
  "/users/:userId/fines/all",
  validate(Joi.object({
    reason: Joi.string().min(3).max(500).required()
  })),
  async (req, res, next) => {
    try {
      const result = await adminService.removeAllFines(
        req.params.userId,
        req.validatedBody.reason,
        req.user.basicInfo.userId
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  "/users/:userId/fines/:fineId",
  validate(Joi.object({
    reason: Joi.string().min(3).max(500).required()
  })),
  async (req, res, next) => {
    try {
      const result = await adminService.removeFine(
        req.params.userId,
        req.params.fineId,
        req.validatedBody.reason,
        req.user.basicInfo.userId
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.get("/fines", async (req, res, next) => {
  try {
    const result = await adminService.getFinesSummary();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/fines/apply-daily", async (req, res, next) => {
  try {
    const fineService = require("../services/fineService");
    const count = await fineService.applyDailyFines();
    res.json({ success: true, message: `Applied daily fines to ${count} users` });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/fines/bulk",
  validate(Joi.object({
    userIds: Joi.array().items(Joi.string()).min(1).required(),
    amount: Joi.number().integer().min(1).required(),
    reason: Joi.string().min(3).max(500).required()
  })),
  async (req, res, next) => {
    try {
      const result = await adminService.addBulkFines(
        req.validatedBody.userIds,
        req.validatedBody.amount,
        req.validatedBody.reason,
        req.user.basicInfo.userId
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/fines/clear-all",
  validate(Joi.object({
    reason: Joi.string().min(3).max(500).required()
  })),
  async (req, res, next) => {
    try {
      const result = await adminService.clearAllFines(
        req.validatedBody.reason,
        req.user.basicInfo.userId
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
