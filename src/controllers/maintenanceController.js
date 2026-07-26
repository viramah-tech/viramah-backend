const MaintenanceRequest = require("../models/MaintenanceRequest");
const User = require("../models/User");
const { uploadToS3 } = require("../middleware/upload");
const { ValidationError } = require("../utils/errors");

// ── Student: Create new maintenance request ───────────────
exports.createRequest = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ success: false, error: { message: "Unauthorized" } });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, error: { message: "User not found" } });

    const { department, issueTitle, description, priority } = req.body;

    if (!department || !issueTitle) {
      return res.status(400).json({ success: false, error: { message: "department and issueTitle are required" } });
    }

    // Upload images to S3
    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadToS3(file, `maintenance`);
        imageUrls.push(url);
      }
    }

    const ticket = new MaintenanceRequest({
      studentRef: user._id,
      studentName: user.fullName || user.basicInfo?.fullName || "Student",
      roomNumber: user.roomNumber || user.basicInfo?.roomNumber || "N/A",
      phone: user.phone || user.basicInfo?.phone || "",
      department,
      issueTitle,
      description: description || "",
      priority: priority || "normal",
      images: imageUrls,
      status: "pending",
      statusHistory: [
        {
          status: "pending",
          note: "Request submitted by student",
          updatedBy: user.fullName || user.basicInfo?.fullName || "Student",
        },
      ],
    });

    await ticket.save();

    return res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
};

// ── Student: Get their own requests ───────────────────────
exports.getStudentRequests = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ success: false, error: { message: "Unauthorized" } });

    const requests = await MaintenanceRequest.find({ studentRef: userId })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: requests });
  } catch (err) {
    next(err);
  }
};

// ── Admin: Get all requests with filters ──────────────────
exports.getAllRequests = async (req, res, next) => {
  try {
    const { search, department, status, priority, startDate, endDate, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { studentName: regex },
        { ticketId: regex },
        { roomNumber: regex },
        { issueTitle: regex },
        { phone: regex },
      ];
    }

    if (department && department !== "all") filter.department = department;
    if (status && status !== "all") filter.status = status;
    if (priority && priority !== "all") filter.priority = priority;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const requests = await MaintenanceRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await MaintenanceRequest.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: {
        requests,
        pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Admin: Update request status ──────────────────────────
exports.updateRequestStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, assignedTo, adminNotes, note } = req.body;

    const ticket = await MaintenanceRequest.findById(id);
    if (!ticket) return res.status(404).json({ success: false, error: { message: "Ticket not found" } });

    if (status) {
      ticket.status = status;
      ticket.statusHistory.push({
        status,
        note: note || `Status updated to ${status}`,
        updatedBy: req.user?.fullName || req.user?.basicInfo?.fullName || "Admin",
        timestamp: new Date(),
      });

      if (status === "resolved") ticket.resolvedAt = new Date();
      if (status === "closed") ticket.closedAt = new Date();
    }

    if (assignedTo !== undefined) ticket.assignedTo = assignedTo;
    if (adminNotes !== undefined) ticket.adminNotes = adminNotes;

    await ticket.save();

    return res.status(200).json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
};

// ── Admin: Dashboard stats ────────────────────────────────
exports.getStats = async (req, res, next) => {
  try {
    const [total, pending, assigned, inProgress, resolved, closed] = await Promise.all([
      MaintenanceRequest.countDocuments(),
      MaintenanceRequest.countDocuments({ status: "pending" }),
      MaintenanceRequest.countDocuments({ status: "assigned" }),
      MaintenanceRequest.countDocuments({ status: "in_progress" }),
      MaintenanceRequest.countDocuments({ status: "resolved" }),
      MaintenanceRequest.countDocuments({ status: "closed" }),
    ]);

    // Per-department breakdown
    const departments = ["software", "civil", "electric", "other"];
    const byDepartment = {};
    for (const dept of departments) {
      byDepartment[dept] = {
        total: await MaintenanceRequest.countDocuments({ department: dept }),
        pending: await MaintenanceRequest.countDocuments({ department: dept, status: "pending" }),
        inProgress: await MaintenanceRequest.countDocuments({ department: dept, status: { $in: ["assigned", "in_progress"] } }),
        resolved: await MaintenanceRequest.countDocuments({ department: dept, status: { $in: ["resolved", "closed"] } }),
      };
    }

    return res.status(200).json({
      success: true,
      data: { total, pending, assigned, inProgress, resolved, closed, byDepartment },
    });
  } catch (err) {
    next(err);
  }
};
