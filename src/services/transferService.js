const mongoose = require("mongoose");
const User = require("../models/User");
const Room = require("../models/Room");
const StudentTransfer = require("../models/StudentTransfer");
const { ValidationError, NotFoundError, AuthError } = require("../utils/errors");
const { reapplyApprovedPayments, recalculateGrandTotal } = require("../utils/waterfall");
const { reconcileAccountState } = require("../utils/accountState");
const { logAdminAction } = require("../utils/auditLogger");

const STAFF_USER_IDS = ["ADMIN", "ACCOUNTANT_1", "INCHARGE_1", "MANAGER_SYSTEM", "ACCOUNTANT_SYSTEM", "HOSTEL_INCHARGE_SYSTEM"];
const STAFF_ID_REGEX = /^(admin|accountant|incharge|manager)/i;

/**
 * Fast search for students eligible as transfer source or target.
 */
const getEligibleStudents = async (query = "") => {
  const filter = {
    role: { $in: ["user", "tenant"] },
    "basicInfo.userId": { $nin: STAFF_USER_IDS, $not: STAFF_ID_REGEX }
  };

  if (query && query.trim()) {
    const q = query.trim();
    const regex = new RegExp(q, "i");
    filter.$or = [
      { "basicInfo.userId": regex },
      { "basicInfo.fullName": regex },
      { "basicInfo.email": regex },
      { "basicInfo.phone": regex },
      { "roomDetails.roomNumber": regex },
    ];
  }

  const students = await User.find(filter)
    .select("basicInfo roomDetails onboarding accountStatus paymentSummary cancellation createdAt")
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  return students.map((s) => {
    const paid = s.paymentSummary?.grandTotal?.paid || 0;
    const refunded = s.paymentSummary?.refundedAmount || 0;
    const availableBalance = Math.max(0, paid - refunded);
    const pendingDue = s.paymentSummary?.grandTotal?.remaining || 0;

    return {
      _id: s._id,
      userId: s.basicInfo?.userId || "",
      fullName: s.basicInfo?.fullName || "Unnamed Student",
      email: s.basicInfo?.email || "",
      phone: s.basicInfo?.phone || "",
      accountStatus: s.accountStatus || "pending",
      isCancelled: s.accountStatus === "cancelled" || !!s.cancellation?.isCancelled,
      roomNumber: s.roomDetails?.roomNumber || "Unassigned",
      bedNumber: s.roomDetails?.bedNumber || "—",
      currentStep: s.onboarding?.currentStep || "compliance",
      paidAmount: paid,
      refundedAmount: refunded,
      availableBalance,
      pendingDue,
    };
  });
};

/**
 * Execute student amount transfer / hostel cancellation exchange.
 * Strictly restricted to Manager, Admin, and Accountant.
 */
const executeStudentTransfer = async (data, actor) => {
  const allowedRoles = ["admin", "manager", "accountant"];
  if (!actor || !allowedRoles.includes(actor.role)) {
    throw new AuthError("Access denied: Only Admin, Manager, and Accountant can transfer student amounts");
  }

  const {
    fromStudentId,
    toStudentId,
    amount,
    targetCategory = "room_rent",
    reason,
    notes = "",
    markFromStudentAsCancelled = false,
  } = data;

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    throw new ValidationError("Transfer amount must be greater than zero");
  }

  if (!reason || reason.trim() === "") {
    throw new ValidationError("A reason for the transfer / hostel exchange is required");
  }

  if (!fromStudentId || !toStudentId) {
    throw new ValidationError("Both source and destination students are required");
  }

  // 1. Locate Source Student
  const fromQuery = mongoose.isValidObjectId(fromStudentId)
    ? { _id: fromStudentId }
    : { "basicInfo.userId": fromStudentId };
  const fromUser = await User.findOne(fromQuery);
  if (!fromUser) {
    throw new NotFoundError("Source student (transferring out) not found");
  }

  // 2. Locate Destination Student
  const toQuery = mongoose.isValidObjectId(toStudentId)
    ? { _id: toStudentId }
    : { "basicInfo.userId": toStudentId };
  const toUser = await User.findOne(toQuery);
  if (!toUser) {
    throw new NotFoundError("Destination student (receiving credit) not found");
  }

  // Ensure not self-transfer
  if (fromUser._id.toString() === toUser._id.toString()) {
    throw new ValidationError("Cannot transfer amount to the same student account");
  }

  // 3. Verify Source Balance
  const paid = fromUser.paymentSummary?.grandTotal?.paid || 0;
  const alreadyRefunded = fromUser.paymentSummary?.refundedAmount || 0;
  const availableBalance = Math.max(0, paid - alreadyRefunded);

  if (numAmount > availableBalance) {
    throw new ValidationError(
      `Insufficient transferable balance. Student ${fromUser.basicInfo?.fullName} has ₹${availableBalance.toLocaleString("en-IN")} available, requested ₹${numAmount.toLocaleString("en-IN")}`
    );
  }

  // 4. Generate unique transfer reference
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  const transferId = `TRF-${dateStr}-${randCode}`;

  let freedRoomInfo = { roomNumber: null, bedNumber: null };

  // 5. Debit / Adjust Source Student
  if (!fromUser.paymentSummary) fromUser.paymentSummary = {};
  fromUser.paymentSummary.refundedAmount = (fromUser.paymentSummary.refundedAmount || 0) + numAmount;
  recalculateGrandTotal(fromUser.paymentSummary);

  // If cancellation option selected or if student was not already cancelled:
  if (markFromStudentAsCancelled) {
    // Release assigned room and bed
    if (fromUser.roomDetails?.roomRef) {
      try {
        const room = await Room.findById(fromUser.roomDetails.roomRef);
        if (room) {
          if (room.beds && room.beds.length > 0) {
            const bed = room.beds.find(
              (b) =>
                (b.occupiedBy && b.occupiedBy.toString() === fromUser._id.toString()) ||
                b.bedNumber === fromUser.roomDetails.bedNumber
            );
            if (bed) {
              bed.isOccupied = false;
              bed.occupiedBy = null;
            }
          }
          room.currentOccupancy = Math.max(0, (room.currentOccupancy || 1) - 1);
          if (room.currentOccupancy < room.capacity) {
            room.status = "Available";
          }
          await room.save();
        }
      } catch (roomErr) {
        console.error("[TRANSFER] Error releasing room bed for source student:", roomErr);
      }

      freedRoomInfo = {
        roomNumber: fromUser.roomDetails.roomNumber,
        bedNumber: fromUser.roomDetails.bedNumber,
      };
      fromUser.roomDetails.roomRef = null;
      fromUser.roomDetails.roomNumber = null;
      fromUser.roomDetails.bedNumber = null;
      fromUser.roomDetails.status = "unassigned";
      fromUser.roomDetails.allocationDate = null;
    }

    if (fromUser.transportPass) {
      fromUser.transportPass.status = "cancelled";
    }

    fromUser.accountStatus = "cancelled";
    fromUser.cancellation = {
      isCancelled: true,
      cancelledAt: new Date(),
      cancelledBy: actor.userId,
      cancellationReason: `Hostel Exchange Transfer: Transferred ₹${numAmount.toLocaleString("en-IN")} to ${toUser.basicInfo?.fullName} (${toUser.basicInfo?.userId}). ${reason}`.trim(),
      refundAmount: (fromUser.cancellation?.refundAmount || 0) + numAmount,
      refundStatus: "processed",
      refundMode: "hostel_transfer",
      refundTransactionId: transferId,
      refundDate: new Date(),
      refundNotes: `Hostel exchange to student ${toUser.basicInfo?.fullName} (${toUser.basicInfo?.userId}). ${notes}`.trim(),
    };

    // Zero remaining dues
    const categories = ["registrationFee", "securityDeposit", "roomRent", "messFee", "transportFee", "fines"];
    for (const cat of categories) {
      if (fromUser.paymentSummary[cat]) {
        fromUser.paymentSummary[cat].remaining = 0;
      }
    }
    if (fromUser.paymentSummary.grandTotal) {
      fromUser.paymentSummary.grandTotal.remaining = 0;
    }
    fromUser.paymentSummary.isFullyPaid = true;
  }

  await fromUser.save();

  // 6. Credit Destination Student
  const paymentId = `PAY-TRF-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
  const paymentType = toUser.onboarding?.currentStep === "booking_payment" ? "booking" : "full";

  const paymentRecord = {
    paymentId,
    paymentType,
    category: targetCategory === "booking" ? "booking" : targetCategory,
    method: "hostel_transfer",
    transactionId: transferId,
    amounts: { totalAmount: numAmount },
    status: "approved",
    reviewedBy: actor.userId,
    reviewedAt: new Date(),
    paidAt: new Date(),
    breakdown: {
      registrationFee: 0,
      securityDeposit: 0,
      roomRent: 0,
      messFee: 0,
      transportFee: 0,
      fines: 0,
    },
  };

  if (!toUser.paymentDetails) toUser.paymentDetails = [];
  toUser.paymentDetails.push(paymentRecord);

  // Recalculate waterfall and advance state
  reapplyApprovedPayments(toUser);

  if (paymentType === "booking" && toUser.onboarding?.currentStep === "booking_payment") {
    toUser.onboarding.currentStep = "final_payment";
  }

  const reconciledState = reconcileAccountState(toUser);
  toUser.accountStatus = reconciledState.accountStatus;
  toUser.onboarding.currentStep = reconciledState.onboarding.currentStep;

  if (reconciledState.onboarding.currentStep === "completed") {
    toUser.onboarding.completedAt = new Date();
  }

  await toUser.save();

  // 7. Create StudentTransfer Audit Document
  const transferDoc = await StudentTransfer.create({
    transferId,
    fromStudent: fromUser._id,
    fromStudentUserId: fromUser.basicInfo.userId,
    fromStudentName: fromUser.basicInfo.fullName || "",
    fromStudentEmail: fromUser.basicInfo.email || "",
    toStudent: toUser._id,
    toStudentUserId: toUser.basicInfo.userId,
    toStudentName: toUser.basicInfo.fullName || "",
    toStudentEmail: toUser.basicInfo.email || "",
    amount: numAmount,
    targetCategory,
    reason: reason.trim(),
    notes: notes.trim(),
    markFromStudentAsCancelled: !!markFromStudentAsCancelled,
    freedRoom: freedRoomInfo,
    creditedPaymentId: paymentId,
    authorizedBy: {
      userId: actor.userId,
      role: actor.role,
      fullName: actor.fullName || actor.name || "Authorized Staff",
    },
    status: "completed",
    transferDate: new Date(),
  });

  // 8. Log audit trail
  logAdminAction("STUDENT_TRANSFER", actor.userId, fromUser.basicInfo.userId, {
    transferId,
    amount: numAmount,
    toStudentUserId: toUser.basicInfo.userId,
    markFromStudentAsCancelled: !!markFromStudentAsCancelled,
    reason,
  });

  return {
    transfer: transferDoc,
    sourceStudent: {
      userId: fromUser.basicInfo.userId,
      fullName: fromUser.basicInfo.fullName,
      accountStatus: fromUser.accountStatus,
      newAvailableBalance: Math.max(0, (fromUser.paymentSummary?.grandTotal?.paid || 0) - (fromUser.paymentSummary?.refundedAmount || 0)),
      freedRoom: freedRoomInfo,
    },
    destinationStudent: {
      userId: toUser.basicInfo.userId,
      fullName: toUser.basicInfo.fullName,
      accountStatus: toUser.accountStatus,
      onboardingStep: toUser.onboarding?.currentStep,
      newPendingDue: toUser.paymentSummary?.grandTotal?.remaining || 0,
      creditedAmount: numAmount,
    },
  };
};

/**
 * List transfer records with search and pagination.
 */
const listTransfers = async (params = {}) => {
  const { page = 1, limit = 20, search = "" } = params;
  const filter = {};

  if (search && search.trim()) {
    const q = search.trim();
    const regex = new RegExp(q, "i");
    filter.$or = [
      { transferId: regex },
      { fromStudentUserId: regex },
      { fromStudentName: regex },
      { fromStudentEmail: regex },
      { toStudentUserId: regex },
      { toStudentName: regex },
      { toStudentEmail: regex },
      { reason: regex },
    ];
  }

  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
  const numLimit = Math.min(100, Math.max(1, Number(limit)));

  const [transfers, total] = await Promise.all([
    StudentTransfer.find(filter)
      .populate("fromStudent", "basicInfo roomDetails accountStatus")
      .populate("toStudent", "basicInfo roomDetails accountStatus")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(numLimit)
      .lean(),
    StudentTransfer.countDocuments(filter),
  ]);

  // Aggregate stats
  const statsAgg = await StudentTransfer.aggregate([
    {
      $group: {
        _id: null,
        totalTransferred: { $sum: "$amount" },
        totalTransfers: { $sum: 1 },
        cancelledSwaps: {
          $sum: { $cond: [{ $eq: ["$markFromStudentAsCancelled", true] }, 1, 0] },
        },
      },
    },
  ]);

  const stats = statsAgg[0] || {
    totalTransferred: 0,
    totalTransfers: 0,
    cancelledSwaps: 0,
  };

  return {
    transfers,
    pagination: {
      total,
      page: Number(page),
      limit: numLimit,
      pages: Math.ceil(total / numLimit) || 1,
    },
    stats: {
      totalTransferred: stats.totalTransferred,
      totalTransfers: stats.totalTransfers,
      cancelledSwaps: stats.cancelledSwaps,
    },
  };
};

module.exports = {
  getEligibleStudents,
  executeStudentTransfer,
  listTransfers,
};
