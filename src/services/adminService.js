const User = require("../models/User");
const RoomType = require("../models/RoomType");
const PricingConfig = require("../models/PricingConfig");
const { allocateWaterfall, recalculateGrandTotal } = require("../utils/waterfall");
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require("../utils/errors");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { logPaymentAudit, logAdminAction } = require("../utils/auditLogger");
const { sendPaymentReceiptEmail } = require("./emailService");
const { reconcileAccountState } = require("../utils/accountState");

const CATEGORY_KEYS = [
  "registrationFee",
  "securityDeposit",
  "roomRent",
  "messFee",
  "transportFee",
  "fines",
];

const getUsers = async ({ status, step, search, page = 1, limit = 20 }) => {
  const query = {};
  if (status) query.accountStatus = status;
  if (step) query["onboarding.currentStep"] = step;

  if (search && search.trim() !== "") {
    const escapedSearch = search.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, "i");
    query.$or = [
      { "basicInfo.fullName": searchRegex },
      { "basicInfo.email": searchRegex },
      { "basicInfo.phone": searchRegex },
      { "basicInfo.userId": searchRegex },
      { "basicInfo.residentId": searchRegex },
      { "guardianDetails.fullName": searchRegex },
      { "paymentDetails.transactionId": searchRegex }
    ];
  }

  const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  const [users, total] = await Promise.all([
    User.find(query)
      .select("-auth.passwordHash -verification.otp")
      .populate("roomDetails.roomType")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    User.countDocuments(query),
  ]);
  return { users, total, page: Number(page), limit: Number(limit) };
};

const getUserById = async (userId) => {
  const user = await User.findOne({ "basicInfo.userId": userId })
    .select("-auth.passwordHash -verification.otp")
    .populate("roomDetails.roomType");
  if (!user) throw new NotFoundError("User not found");
  return user;
};

const updateRoomRentDiscounts = async (userId, fullPaymentDiscountPct, halfPaymentDiscountPct, customRackRate, appliedRoomRent) => {
  const user = await User.findOne({ "basicInfo.userId": userId }).populate("roomDetails.roomType");
  if (!user) throw new NotFoundError("User not found");

  if (typeof fullPaymentDiscountPct === "number") {
    user.paymentSummary.roomRent.fullPaymentDiscountPct = fullPaymentDiscountPct;
  }
  if (typeof halfPaymentDiscountPct === "number") {
    user.paymentSummary.roomRent.halfPaymentDiscountPct = halfPaymentDiscountPct;
  }

  const plan = user.paymentSummary?.roomRent?.selectedPlan;

  if (typeof appliedRoomRent === "number") {
    const activeFullPct = typeof fullPaymentDiscountPct === "number" ? fullPaymentDiscountPct : (user.paymentSummary.roomRent.fullPaymentDiscountPct ?? 40);
    const activeHalfPct = typeof halfPaymentDiscountPct === "number" ? halfPaymentDiscountPct : (user.paymentSummary.roomRent.halfPaymentDiscountPct ?? 25);
    
    let discountPct = 0;
    if (plan === "full") {
      discountPct = activeFullPct;
    } else if (plan === "half") {
      discountPct = activeHalfPct;
    }

    let newBaseRent = appliedRoomRent;
    if (discountPct > 0 && discountPct < 100) {
      newBaseRent = Math.round(appliedRoomRent / (1 - discountPct / 100));
    }

    user.paymentSummary.roomRent.customRackRate = newBaseRent;
    user.paymentSummary.roomRent.appliedDiscountValue = newBaseRent - appliedRoomRent;
    user.paymentSummary.roomRent.total = appliedRoomRent;
    
    const roomRentPaid = user.paymentSummary.roomRent.paid || 0;
    user.paymentSummary.roomRent.remaining = Math.max(0, appliedRoomRent - roomRentPaid);

    recalculateGrandTotal(user.paymentSummary);
  } else {
    if (typeof customRackRate === "number") {
      user.paymentSummary.roomRent.customRackRate = customRackRate;
    }

    if (plan === "full" || plan === "half") {
      const pricing = await PricingConfig.findOne();
      const tenure = pricing?.tenureMonths || 11;
      const roomPrice = user.roomDetails?.roomType?.basePrice || 0;
      
      const rawRoomRent = typeof user.paymentSummary.roomRent.customRackRate === "number" 
        ? user.paymentSummary.roomRent.customRackRate 
        : (roomPrice * tenure);

      const discountPct = plan === "full" ? user.paymentSummary.roomRent.fullPaymentDiscountPct : user.paymentSummary.roomRent.halfPaymentDiscountPct;
      
      const newDiscountValue = Math.round(rawRoomRent * (discountPct / 100));

      user.paymentSummary.roomRent.appliedDiscountValue = newDiscountValue;
      
      const newTotal = rawRoomRent - newDiscountValue;
      user.paymentSummary.roomRent.total = newTotal;
      
      const roomRentPaid = user.paymentSummary.roomRent.paid || 0;
      user.paymentSummary.roomRent.remaining = Math.max(0, newTotal - roomRentPaid);

      recalculateGrandTotal(user.paymentSummary);
    }
  }

  await user.save();
  return user.paymentSummary.roomRent;
};

const getPayments = async (statusFilter) => {
  const query = statusFilter ? { "paymentDetails.status": statusFilter } : { role: "user" };

  const users = await User.find(query)
    .select(
      "basicInfo.userId basicInfo.fullName basicInfo.email basicInfo.phone paymentDetails paymentSummary onboarding roomDetails"
    )
    .sort({ "paymentDetails.paidAt": -1 });

  const paymentsList = [];
  for (const u of users) {
    if (u.paymentDetails && u.paymentDetails.length > 0) {
      for (const p of u.paymentDetails) {
        if (!statusFilter || p.status === statusFilter) {
          paymentsList.push({
            userId: u.basicInfo?.userId || 'UNKNOWN_ID',
            fullName: u.basicInfo?.fullName || 'Unknown User',
            email: u.basicInfo?.email || 'N/A',
            phone: u.basicInfo?.phone || 'N/A',
            payment: p,
            paymentSummary: {
              totalBilled: u.paymentSummary?.grandTotal?.total || 0,
              totalPaid: u.paymentSummary?.grandTotal?.paid || 0,
              paymentCount: u.paymentDetails?.length || 0,
            },
          });
        }
      }
    } else {
      // No payment details submitted yet
      if (!statusFilter) {
        let category = null;
        let amount = 0;
        let status = "unpaid";
        
        if (u.onboarding?.currentStep === "booking_payment") {
          category = "booking";
          amount = u.paymentSummary?.grandTotal?.total || 16000;
          status = "pending_booking";
        } else if (u.onboarding?.currentStep === "room_selection" || !u.roomDetails?.roomType) {
          status = "no_room_chosen";
        }

        paymentsList.push({
          userId: u.basicInfo?.userId || 'UNKNOWN_ID',
          fullName: u.basicInfo?.fullName || 'Unknown User',
          email: u.basicInfo?.email || 'N/A',
          phone: u.basicInfo?.phone || 'N/A',
          payment: {
            paymentId: `STUB_${u.basicInfo?.userId || 'UNKNOWN'}`,
            paymentType: category === "booking" ? "booking" : "full",
            category: category,
            method: "—",
            transactionId: "—",
            amounts: { totalAmount: amount },
            status: status,
            paidAt: null,
          },
          paymentSummary: {
            totalBilled: u.paymentSummary?.grandTotal?.total || 0,
            totalPaid: u.paymentSummary?.grandTotal?.paid || 0,
            paymentCount: 0,
          },
        });
      }
    }
  }
  
  paymentsList.sort((a, b) => {
    const dateA = a.payment.paidAt ? new Date(a.payment.paidAt) : new Date(0);
    const dateB = b.payment.paidAt ? new Date(b.payment.paidAt) : new Date(0);
    return dateB - dateA;
  });
  return paymentsList;
};

const applyBreakdown = (summary, breakdown) => {
  for (const key of CATEGORY_KEYS) {
    const amount = breakdown[key] || 0;
    if (amount <= 0) continue;
    const entry = summary[key];
    if (!entry) continue;
    entry.paid += amount;
    entry.remaining = Math.max(0, (entry.total || 0) - entry.paid);
  }
  recalculateGrandTotal(summary);
  return summary;
};

const approvePayment = async (userId, paymentId, adminUserId) => {
  // Validate input parameters
  if (!userId || typeof userId !== "string") {
    throw new ValidationError("Invalid user ID format");
  }
  if (!paymentId || typeof paymentId !== "string") {
    throw new ValidationError("Invalid payment ID format");
  }
  if (!adminUserId || typeof adminUserId !== "string") {
    throw new ValidationError("Invalid admin ID format");
  }

  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");

  const payment = user.paymentDetails.find((p) => p.paymentId === paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  if (payment.status !== "pending" && payment.status !== "rejected") {
    throw new ConflictError(`Payment already ${payment.status}`);
  }

  payment.status = "approved";
  payment.reviewedBy = adminUserId;
  payment.reviewedAt = new Date();
  payment.rejectionReason = undefined;
  payment.approvalSignature = crypto
    .createHmac("sha256", process.env.PAYMENT_SIGNATURE_SECRET || "dev-secret")
    .update(`${adminUserId}:${paymentId}:APPROVED:${Date.now()}`)
    .digest("hex");

  // Re-sync all approved payment ledgers dynamically
  const { reapplyApprovedPayments } = require("../utils/waterfall");
  reapplyApprovedPayments(user);

  // First approved booking payment moves onboarding step
  if (payment.paymentType === "booking") {
    if (user.onboarding.currentStep === "booking_payment") {
      user.onboarding.currentStep = "final_payment";
    }
  }

  const reconciledState = reconcileAccountState(user);
  user.accountStatus = reconciledState.accountStatus;
  user.onboarding.currentStep = reconciledState.onboarding.currentStep;

  if (reconciledState.onboarding.currentStep === "completed") {
    user.onboarding.completedAt = new Date();
  }

  // For half plan: mark as completed once ALL of these are met:
  // 1. Room rent paid >= 60% of discounted room rent
  // 2. Security deposit fully paid
  // 3. Registration fee fully paid
  // 4. Mess fee fully paid (if selected, i.e. total > 0)
  // 5. Transport fee fully paid (if selected, i.e. total > 0)
  if (
    user.onboarding.currentStep !== "completed" &&
    user.paymentSummary.roomRent?.selectedPlan === "half"
  ) {
    const ps = user.paymentSummary;
    const discountedRoomRent =
      ps.roomRent.total - (ps.roomRent.appliedDiscountValue || 0);
    const sixtyPctTarget = Math.round(discountedRoomRent * 0.60);

    const roomRentOk = ps.roomRent.paid >= sixtyPctTarget;
    const securityOk = ps.securityDeposit.remaining <= 0;
    const registrationOk = ps.registrationFee.remaining <= 0;
    const messOk = ps.messFee.total === 0 || ps.messFee.remaining <= 0;
    const transportOk = ps.transportFee.total === 0 || ps.transportFee.remaining <= 0;

    if (roomRentOk && securityOk && registrationOk && messOk && transportOk) {
      user.onboarding.currentStep = "completed";
      user.onboarding.completedAt = new Date();
      user.accountStatus = "active";
    }
  }

  const finalReconciledState = reconcileAccountState(user);
  user.accountStatus = finalReconciledState.accountStatus;
  user.onboarding.currentStep = finalReconciledState.onboarding.currentStep;
  if (finalReconciledState.onboarding.currentStep === "completed") {
    user.onboarding.completedAt = new Date();
  }

  await user.save();

  logPaymentAudit("APPROVED", userId, paymentId, payment.amounts.totalAmount, {
    adminId: adminUserId,
    paymentType: payment.paymentType,
  });

  logAdminAction("APPROVE_PAYMENT", adminUserId, userId, {
    paymentId,
    amount: payment.amounts.totalAmount,
  });

  sendPaymentReceiptEmail(user, payment).catch(() => {});

  return { payment, paymentSummary: user.paymentSummary, onboarding: user.onboarding };
};

const rejectPayment = async (userId, paymentId, adminUserId, reason) => {
  // Validate input parameters
  if (!userId || typeof userId !== "string") {
    throw new ValidationError("Invalid user ID format");
  }
  if (!paymentId || typeof paymentId !== "string") {
    throw new ValidationError("Invalid payment ID format");
  }
  if (!adminUserId || typeof adminUserId !== "string") {
    throw new ValidationError("Invalid admin ID format");
  }
  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    throw new ValidationError("Rejection reason is required");
  }
  if (reason.length > 500) {
    throw new ValidationError("Rejection reason is too long (max 500 characters)");
  }

  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");

  const payment = user.paymentDetails.find((p) => p.paymentId === paymentId);
  if (!payment) throw new NotFoundError("Payment not found");
  
  const wasApproved = payment.status === "approved";
  if (payment.status !== "pending" && payment.status !== "approved") {
    throw new ConflictError(`Payment already ${payment.status}`);
  }

  payment.status = "rejected";
  payment.rejectionReason = reason;
  payment.reviewedBy = adminUserId;
  payment.reviewedAt = new Date();
  payment.rejectionSignature = crypto
    .createHmac("sha256", process.env.PAYMENT_SIGNATURE_SECRET || "dev-secret")
    .update(`${adminUserId}:${paymentId}:REJECTED:${Date.now()}`)
    .digest("hex");

  if (wasApproved) {
    const { reapplyApprovedPayments } = require("../utils/waterfall");
    
    // Recalculate summaries by reapplying only the remaining approved payments
    reapplyApprovedPayments(user);

    // Revert onboarding status if necessary
    const hasApprovedBooking = user.paymentDetails.some(
      (p) => p.paymentType === "booking" && p.status === "approved"
    );

    if (!hasApprovedBooking) {
      user.onboarding.currentStep = "booking_payment";
      user.paymentDeadline = undefined;
      user.onboarding.completedAt = undefined;
      user.accountStatus = "pending";
    } else {
      const isFullyPaidNow = user.paymentSummary?.isFullyPaid;
      
      // Also check half plan target condition
      let halfPlanTargetMet = false;
      if (user.paymentSummary?.roomRent?.selectedPlan === "half") {
        const ps = user.paymentSummary;
        const discountedRoomRent = ps.roomRent.total - (ps.roomRent.appliedDiscountValue || 0);
        const sixtyPctTarget = Math.round(discountedRoomRent * 0.60);

        const roomRentOk = ps.roomRent.paid >= sixtyPctTarget;
        const securityOk = ps.securityDeposit.remaining <= 0;
        const registrationOk = ps.registrationFee.remaining <= 0;
        const messOk = ps.messFee.total === 0 || ps.messFee.remaining <= 0;
        const transportOk = ps.transportFee.total === 0 || ps.transportFee.remaining <= 0;
        
        halfPlanTargetMet = roomRentOk && securityOk && registrationOk && messOk && transportOk;
      }
      
      if (!isFullyPaidNow && !halfPlanTargetMet) {
        user.onboarding.currentStep = "final_payment";
        user.onboarding.completedAt = undefined;
        user.accountStatus = "pending";
      }
    }
  }

  const reconciledState = reconcileAccountState(user);
  user.accountStatus = reconciledState.accountStatus;
  user.onboarding.currentStep = reconciledState.onboarding.currentStep;
  if (reconciledState.onboarding.currentStep === "completed") {
    user.onboarding.completedAt = new Date();
  } else {
    user.onboarding.completedAt = undefined;
  }
  
  await user.save();
  
  logPaymentAudit("REJECTED", userId, paymentId, payment.amounts.totalAmount, {
    adminId: adminUserId,
    reason: reason,
    paymentType: payment.paymentType,
  });
  
  logAdminAction("REJECT_PAYMENT", adminUserId, userId, {
    paymentId,
    amount: payment.amounts.totalAmount,
    reason: reason,
  });
  
  return { payment };
};

const getDashboard = async () => {
  const [totalUsers, activeUsers, byStep, pendingPayments, revenueAgg, roomTypes] = await Promise.all([
    User.countDocuments({ role: "user" }),
    User.countDocuments({ role: "user", accountStatus: "active" }),
    User.aggregate([
      { $match: { role: "user" } },
      { $group: { _id: "$onboarding.currentStep", count: { $sum: 1 } } },
    ]),
    User.countDocuments({ "paymentDetails.status": "pending" }),
    User.aggregate([
      { $unwind: "$paymentDetails" },
      { $match: { "paymentDetails.status": "approved" } },
      { $group: { _id: null, total: { $sum: "$paymentDetails.amounts.totalAmount" } } },
    ]),
    RoomType.find({ isActive: true }).lean().catch(() => []),
  ]);

  const usersByStep = byStep.reduce((acc, b) => {
    acc[b._id] = b.count;
    return acc;
  }, {});

  const totalBeds = roomTypes.reduce((sum, r) => sum + (r.totalRooms || 0) * (r.capacity || 1), 0);
  const availableBeds = roomTypes.reduce((sum, r) => sum + (r.availableRooms || 0) * (r.capacity || 1), 0);

  return {
    totalUsers,
    activeUsers,
    usersByStep,
    onboardingStats: usersByStep,
    pendingPayments,
    totalRevenue: revenueAgg[0]?.total || 0,
    roomOccupancy: {
      totalBeds,
      totalOccupied: totalBeds - availableBeds,
    },
  };
};

const updatePricing = async (data) => {
  const existing = await PricingConfig.findOne();
  if (existing) {
    Object.assign(existing, data);
    await existing.save();
    return existing;
  }
  return PricingConfig.create(data);
};

const createRoomType = async (data) => RoomType.create(data);

const updateRoomType = async (id, data) => {
  const room = await RoomType.findByIdAndUpdate(id, data, { new: true });
  if (!room) throw new NotFoundError("Room type not found");
  return room;
};

const updateUserStatus = async (userId, status) => {
  const validStatuses = ["pending", "active", "suspended", "blocked"];
  if (!validStatuses.includes(status)) {
    throw new ValidationError(`Status must be one of: ${validStatuses.join(", ")}`);
  }
  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");
  user.accountStatus = status;
  if (status === "blocked") user.auth.isBlocked = true;
  else if (status === "active") user.auth.isBlocked = false;
  await user.save();
  return { userId, accountStatus: user.accountStatus };
};

const verifyUserDocuments = async (userId, adminUserId) => {
  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");
  user.verification.documentVerified = true;
  user.verification.documentVerificationStatus = "approved";
  user.verification.documentRejectionReason = null;
  const reconciledState = reconcileAccountState(user);
  user.accountStatus = reconciledState.accountStatus;
  user.onboarding.currentStep = reconciledState.onboarding.currentStep;
  if (reconciledState.onboarding.currentStep === "completed") {
    user.onboarding.completedAt = new Date();
  }
  await user.save();
  logAdminAction("VERIFY_DOCUMENTS", adminUserId, userId, {});
  return { userId, documentVerified: true, status: "approved" };
};

const rejectUserDocuments = async (userId, adminUserId, reason) => {
  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    throw new ValidationError("Rejection reason is required");
  }

  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");

  user.verification.documentVerified = false;
  user.verification.documentVerificationStatus = "rejected";
  user.verification.documentRejectionReason = reason;
  const reconciledState = reconcileAccountState(user);
  user.accountStatus = reconciledState.accountStatus;
  user.onboarding.currentStep = reconciledState.onboarding.currentStep;
  user.onboarding.completedAt = undefined;
  
  await user.save();
  logAdminAction("REJECT_DOCUMENTS", adminUserId, userId, { reason });
  return { userId, documentVerified: false, status: "rejected" };
};

const completeMoveIn = async (userId, adminUserId) => {
  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");
  if (!user.verification.documentVerified) {
    throw new ValidationError("Documents must be verified before completing move-in");
  }
  if (!user.paymentSummary?.isFullyPaid) {
    throw new ValidationError("All payments must be completed before move-in");
  }
  if (!user.roomDetails) user.roomDetails = {};
  user.roomDetails.status = "checked_in";
  user.roomDetails.allocationDate = new Date();
  const reconciledState = reconcileAccountState(user);
  user.accountStatus = reconciledState.accountStatus;
  user.onboarding.currentStep = reconciledState.onboarding.currentStep;
  if (reconciledState.onboarding.currentStep === "completed") {
    user.onboarding.completedAt = new Date();
  }
  await user.save();
  logAdminAction("COMPLETE_MOVE_IN", adminUserId, userId, {});
  return { userId, roomStatus: user.roomDetails.status };
};

const deleteUser = async (userId, adminUserId) => {
  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");
  
  await User.deleteOne({ "basicInfo.userId": userId });
  logAdminAction("DELETE_USER", adminUserId, userId, { deletedAt: new Date() });
  
  return { success: true };
};

const updateUserDetails = async (userId, userDetails, adminUserId) => {
  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");

  if (userDetails.basicInfo) {
    if (userDetails.basicInfo.fullName !== undefined) user.basicInfo.fullName = userDetails.basicInfo.fullName;
    if (userDetails.basicInfo.phone !== undefined) user.basicInfo.phone = userDetails.basicInfo.phone;
    if (userDetails.basicInfo.gender !== undefined) user.basicInfo.gender = userDetails.basicInfo.gender;
    if (userDetails.basicInfo.dateOfBirth !== undefined) user.basicInfo.dateOfBirth = userDetails.basicInfo.dateOfBirth;
    if (userDetails.basicInfo.address !== undefined) user.basicInfo.address = userDetails.basicInfo.address;
  }

  if (userDetails.guardian) {
    if (!user.guardian) user.guardian = {};
    if (userDetails.guardian.fullName !== undefined) user.guardian.fullName = userDetails.guardian.fullName;
    if (userDetails.guardian.relation !== undefined) user.guardian.relation = userDetails.guardian.relation;
    if (userDetails.guardian.phone !== undefined) user.guardian.phone = userDetails.guardian.phone;
    if (userDetails.guardian.alternatePhone !== undefined) user.guardian.alternatePhone = userDetails.guardian.alternatePhone;
  }

  if (userDetails.disableAutoFines !== undefined) {
    user.disableAutoFines = userDetails.disableAutoFines;
  }

  await user.save();
  logAdminAction("UPDATE_USER_DETAILS", adminUserId, userId, { updatedFields: userDetails });
  return user;
};

const changeUserPassword = async (userId, newPassword, adminUserId) => {
  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");

  const passwordHash = await bcrypt.hash(newPassword, 10);

  if (!user.auth) user.auth = {};
  user.auth.passwordHash = passwordHash;

  await user.save();

  logAdminAction("CHANGE_USER_PASSWORD", adminUserId, userId, {});

  return { userId, success: true };
};

const updateSecurityDeposit = async (userId, newDepositAmount, adminUserId) => {
  if (typeof newDepositAmount !== "number" || Number.isNaN(newDepositAmount) || newDepositAmount < 0) {
    throw new ValidationError("Security deposit must be a valid non-negative number");
  }

  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");

  if (!user.paymentSummary) {
    user.paymentSummary = {};
  }
  if (!user.paymentSummary.securityDeposit) {
    user.paymentSummary.securityDeposit = { total: 0, paid: 0, remaining: 0 };
  }

  const paidSoFar = user.paymentSummary.securityDeposit.paid || 0;
  user.paymentSummary.securityDeposit.total = newDepositAmount;
  user.paymentSummary.securityDeposit.remaining = Math.max(0, newDepositAmount - paidSoFar);

  const { recalculateGrandTotal } = require("../utils/waterfall");
  recalculateGrandTotal(user.paymentSummary);

  await user.save();
  logAdminAction("UPDATE_SECURITY_DEPOSIT", adminUserId, userId, { newDepositAmount });

  return {
    userId,
    securityDeposit: user.paymentSummary.securityDeposit,
    grandTotal: user.paymentSummary.grandTotal,
  };
};


const addFine = async (userId, amount, reason, adminUserId) => {
  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");

  if (typeof amount !== "number" || amount <= 0) {
    throw new ValidationError("Fine amount must be a positive number");
  }
  if (!reason || reason.trim() === "") {
    throw new ValidationError("Reason is required");
  }

  const fineId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");

  if (!user.finesList) user.finesList = [];
  user.finesList.push({
    fineId,
    amount,
    reason,
    date: new Date(),
    addedBy: adminUserId,
    type: "manual",
    isRemoved: false,
  });

  if (!user.paymentSummary.fines) {
    user.paymentSummary.fines = { total: 0, paid: 0, remaining: 0 };
  }
  user.paymentSummary.fines.total = (user.paymentSummary.fines.total || 0) + amount;
  user.paymentSummary.fines.remaining = (user.paymentSummary.fines.remaining || 0) + amount;

  recalculateGrandTotal(user.paymentSummary);

  await user.save();
  logAdminAction("ADD_FINE", adminUserId, userId, { amount, reason, fineId });
  return user;
};

const removeFine = async (userId, fineId, reason, adminUserId) => {
  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");

  if (!reason || reason.trim() === "") {
    throw new ValidationError("Removal reason is required");
  }

  if (!user.finesList) user.finesList = [];
  const fine = user.finesList.find((f) => f.fineId === fineId);
  if (!fine) throw new NotFoundError("Fine not found");
  if (fine.isRemoved) throw new ValidationError("Fine already removed");

  fine.isRemoved = true;
  fine.removedBy = adminUserId;
  fine.removedAt = new Date();
  fine.removalReason = reason;

  if (user.paymentSummary.fines) {
    user.paymentSummary.fines.total = Math.max(0, (user.paymentSummary.fines.total || 0) - fine.amount);
    user.paymentSummary.fines.remaining = Math.max(0, (user.paymentSummary.fines.remaining || 0) - fine.amount);
  }

  recalculateGrandTotal(user.paymentSummary);

  await user.save();
  logAdminAction("REMOVE_FINE", adminUserId, userId, { fineId, reason });
  return user;
};

const removeAllFines = async (userId, reason, adminUserId) => {
  const user = await User.findOne({ "basicInfo.userId": userId });
  if (!user) throw new NotFoundError("User not found");

  if (!reason || reason.trim() === "") {
    throw new ValidationError("Removal reason is required");
  }

  if (!user.finesList || user.finesList.length === 0) {
    throw new ValidationError("No fines found for this user");
  }

  let removedAmount = 0;
  let linesAffected = 0;

  user.finesList.forEach((fine) => {
    if (!fine.isRemoved) {
      fine.isRemoved = true;
      fine.removedBy = adminUserId;
      fine.removedAt = new Date();
      fine.removalReason = reason;
      removedAmount += fine.amount;
      linesAffected++;
    }
  });

  if (linesAffected === 0) {
    throw new ValidationError("No active fines to remove");
  }

  if (user.paymentSummary.fines) {
    user.paymentSummary.fines.total = Math.max(0, (user.paymentSummary.fines.total || 0) - removedAmount);
    user.paymentSummary.fines.remaining = Math.max(0, (user.paymentSummary.fines.remaining || 0) - removedAmount);
  }

  recalculateGrandTotal(user.paymentSummary);

  await user.save();
  logAdminAction("REMOVE_ALL_FINES", adminUserId, userId, { reason, removedAmount, linesAffected });
  return user;
};

const addBulkFines = async (userIds, amount, reason, adminUserId) => {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new ValidationError("User IDs must be a non-empty array");
  }
  if (typeof amount !== "number" || amount <= 0) {
    throw new ValidationError("Fine amount must be a positive number");
  }
  if (!reason || reason.trim() === "") {
    throw new ValidationError("Reason is required");
  }

  const results = [];
  for (const userId of userIds) {
    try {
      await addFine(userId, amount, reason, adminUserId);
      results.push({ userId, success: true });
    } catch (err) {
      results.push({ userId, success: false, error: err.message });
    }
  }
  return results;
};

const getFinesSummary = async () => {
  const users = await User.find({
    $or: [
      { "finesList.0": { $exists: true } },
      { "paymentSummary.fines.total": { $gt: 0 } }
    ]
  }, "basicInfo finesList paymentSummary");

  let totalImposed = 0;
  let totalActive = 0;
  let totalCollected = 0;
  let totalOutstanding = 0;
  let totalRemoved = 0;
  
  const allFines = [];

  for (const user of users) {
    const fines = user.finesList || [];
    
    totalCollected += user.paymentSummary?.fines?.paid || 0;
    totalOutstanding += user.paymentSummary?.fines?.remaining || 0;

    for (const fine of fines) {
      if (fine.isRemoved) {
        totalRemoved += fine.amount;
      } else {
        totalImposed += fine.amount;
        totalActive += fine.amount;
      }

      allFines.push({
        fineId: fine.fineId,
        amount: fine.amount,
        reason: fine.reason,
        date: fine.date,
        addedBy: fine.addedBy,
        type: fine.type || "manual",
        isRemoved: fine.isRemoved,
        removedBy: fine.removedBy,
        removedAt: fine.removedAt,
        removalReason: fine.removalReason,
        student: {
          userId: user.basicInfo.userId,
          fullName: user.basicInfo.fullName,
          email: user.basicInfo.email,
          phone: user.basicInfo.phone,
          finesLedger: user.paymentSummary?.fines || { total: 0, paid: 0, remaining: 0 }
        }
      });
    }
  }

  allFines.sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    stats: {
      totalImposed,
      totalActive,
      totalCollected,
      totalOutstanding,
      totalRemoved,
      totalCount: allFines.length,
      activeCount: allFines.filter(f => !f.isRemoved).length,
      removedCount: allFines.filter(f => f.isRemoved).length,
    },
    fines: allFines
  };
};

const clearAllFines = async (reason, adminUserId) => {
  if (!reason || reason.trim() === "") {
    throw new ValidationError("Reason is required to clear all fines");
  }

  // Find all users who have active (non-removed) fines
  const users = await User.find({
    "finesList": { $elemMatch: { isRemoved: false } }
  });

  let totalFinesCleared = 0;
  let studentsAffected = 0;

  for (const user of users) {
    let userFinesCleared = 0;
    let userAmountCleared = 0;

    for (const fine of user.finesList) {
      if (!fine.isRemoved) {
        fine.isRemoved = true;
        fine.removedBy = adminUserId;
        fine.removedAt = new Date();
        fine.removalReason = reason;
        userFinesCleared++;
        userAmountCleared += fine.amount;
      }
    }

    if (userFinesCleared > 0) {
      if (user.paymentSummary.fines) {
        user.paymentSummary.fines.total = Math.max(0, (user.paymentSummary.fines.total || 0) - userAmountCleared);
        user.paymentSummary.fines.remaining = Math.max(0, (user.paymentSummary.fines.remaining || 0) - userAmountCleared);
      }
      recalculateGrandTotal(user.paymentSummary);
      await user.save();
      
      logAdminAction("CLEAR_ALL_FINES_USER", adminUserId, user.basicInfo.userId, { 
        finesCount: userFinesCleared, 
        amount: userAmountCleared, 
        reason 
      });

      totalFinesCleared += userFinesCleared;
      studentsAffected++;
    }
  }

  logAdminAction("CLEAR_ALL_FINES_GLOBAL", adminUserId, null, { 
    totalFinesCleared, 
    studentsAffected, 
    reason 
  });

  return { totalFinesCleared, studentsAffected };
};

module.exports = {
  getUsers,
  getUserById,
  getPayments,
  approvePayment,
  rejectPayment,
  getDashboard,
  updatePricing,
  createRoomType,
  updateRoomType,
  updateUserStatus,
  verifyUserDocuments,
  rejectUserDocuments,
  completeMoveIn,
  updateRoomRentDiscounts,
  deleteUser,
  updateUserDetails,
  addFine,
  removeFine,
  removeAllFines,
  addBulkFines,
  getFinesSummary,
  clearAllFines,
  changeUserPassword,
};

const { parseCSV, mapHeaders, extractUTRFromString } = require("../utils/csvParser");

const reconcileStatement = async (fileBuffer, customMapping = null) => {
  // Convert buffer to string
  const text = fileBuffer.toString("utf8");
  const parsedRows = parseCSV(text);
  
  if (parsedRows.length < 2) {
    throw new ValidationError("Bank statement must contain at least a header row and one data row.");
  }
  
  const headers = parsedRows[0];
  let mapping;
  
  if (customMapping) {
    mapping = {
      dateIdx: typeof customMapping.dateIdx === 'number' ? customMapping.dateIdx : -1,
      descIdx: typeof customMapping.descIdx === 'number' ? customMapping.descIdx : -1,
      refIdx: typeof customMapping.refIdx === 'number' ? customMapping.refIdx : -1,
      amountIdx: typeof customMapping.amountIdx === 'number' ? customMapping.amountIdx : -1,
    };
  } else {
    mapping = mapHeaders(headers);
    if (mapping.amountIdx === -1) {
      return {
        mappingRequired: true,
        headers,
        suggestedMapping: mapping
      };
    }
  }
  
  const { dateIdx, descIdx, refIdx, amountIdx } = mapping;

  // Process rows, parsing amounts and extracting reference numbers
  const bankTransactions = [];
  for (let i = 1; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    if (row.length < Math.max(dateIdx, descIdx, refIdx, amountIdx) + 1) {
      continue; // Skip malformed rows
    }

    const rawDate = dateIdx !== -1 ? row[dateIdx] : "";
    const rawDesc = descIdx !== -1 ? row[descIdx] : "";
    const rawRef = refIdx !== -1 ? row[refIdx] : "";
    const rawAmountStr = amountIdx !== -1 ? row[amountIdx] : "0";

    // Clean amount (remove commas, currency symbols, whitespace)
    const cleanedAmountStr = rawAmountStr.replace(/[^0-9.-]/g, "");
    const amount = parseFloat(cleanedAmountStr);
    
    // We only verify credit transactions (deposits to host's account)
    if (isNaN(amount) || amount <= 0) {
      continue;
    }

    // Extract potential UTR
    let utr = (rawRef || "").trim();
    if (!utr && rawDesc) {
      utr = extractUTRFromString(rawDesc);
    }

    bankTransactions.push({
      index: i,
      date: rawDate.trim(),
      description: rawDesc.trim(),
      rawRef: rawRef.trim(),
      utr: utr,
      amount: amount
    });
  }

  // Get all users who have pending payments
  const users = await User.find({
    "paymentDetails.status": "pending"
  }).select("basicInfo.userId basicInfo.fullName basicInfo.email basicInfo.phone paymentDetails paymentSummary");

  // Flatten pending payments from users
  const pendingPayments = [];
  for (const user of users) {
    if (user.paymentDetails && user.paymentDetails.length > 0) {
      for (const p of user.paymentDetails) {
        if (p.status === "pending") {
          pendingPayments.push({
            userId: user.basicInfo?.userId || "UNKNOWN",
            fullName: user.basicInfo?.fullName || "Unknown",
            email: user.basicInfo?.email || "N/A",
            phone: user.basicInfo?.phone || "N/A",
            payment: {
              paymentId: p.paymentId,
              paymentType: p.paymentType,
              category: p.category,
              method: p.method,
              transactionId: p.transactionId,
              amount: p.amounts?.totalAmount ?? 0,
              paidAt: p.paidAt,
            },
            paymentSummary: {
              totalBilled: user.paymentSummary?.grandTotal?.total || 0,
              totalPaid: user.paymentSummary?.grandTotal?.paid || 0,
            }
          });
        }
      }
    }
  }

  // Matching logic
  const matched = [];
  const partialMatched = [];
  const similarMatched = [];
  const matchedPendingIds = new Set();
  const matchedBankIndices = new Set();

  // Step 1: Exact Matches (matching UTR and Amount)
  for (const bankTx of bankTransactions) {
    if (!bankTx.utr) continue;

    const exactMatchIndex = pendingPayments.findIndex(p => 
      !matchedPendingIds.has(p.payment.paymentId) &&
      p.payment.transactionId && 
      p.payment.transactionId.trim().toLowerCase() === bankTx.utr.toLowerCase() &&
      p.payment.amount === bankTx.amount
    );

    if (exactMatchIndex !== -1) {
      const match = pendingPayments[exactMatchIndex];
      matched.push({
        bankTx,
        pendingPayment: match
      });
      matchedPendingIds.add(match.payment.paymentId);
      matchedBankIndices.add(bankTx.index);
    }
  }

  // Step 2: Partial Matches (matching UTR but different Amount)
  for (const bankTx of bankTransactions) {
    if (matchedBankIndices.has(bankTx.index) || !bankTx.utr) continue;

    const uMatchIndex = pendingPayments.findIndex(p => 
      !matchedPendingIds.has(p.payment.paymentId) &&
      p.payment.transactionId && 
      p.payment.transactionId.trim().toLowerCase() === bankTx.utr.toLowerCase()
    );

    if (uMatchIndex !== -1) {
      const match = pendingPayments[uMatchIndex];
      partialMatched.push({
        bankTx,
        pendingPayment: match,
        reason: "amount_mismatch"
      });
      matchedPendingIds.add(match.payment.paymentId);
      matchedBankIndices.add(bankTx.index);
    }
  }

  // Step 3: Similar Matches (Amount matches, but UTR doesn't)
  for (const bankTx of bankTransactions) {
    if (matchedBankIndices.has(bankTx.index)) continue;

    // Look for any pending payment with matching amount that hasn't been matched yet
    const amountMatchIndex = pendingPayments.findIndex(p =>
      !matchedPendingIds.has(p.payment.paymentId) &&
      p.payment.amount === bankTx.amount
    );

    if (amountMatchIndex !== -1) {
      const match = pendingPayments[amountMatchIndex];
      similarMatched.push({
        bankTx,
        pendingPayment: match,
        reason: "similar_amount"
      });
      matchedPendingIds.add(match.payment.paymentId);
      matchedBankIndices.add(bankTx.index);
    }
  }

  // Unmatched bank transactions
  const unmatchedBank = bankTransactions.filter(tx => !matchedBankIndices.has(tx.index));

  // Unmatched pending payments in DB
  const unmatchedPending = pendingPayments.filter(p => !matchedPendingIds.has(p.payment.paymentId));

  return {
    mappingRequired: false,
    matched,
    partialMatched,
    similarMatched,
    unmatchedBank,
    unmatchedPending,
  };
};

const bulkApprovePayments = async (approvals, adminUserId) => {
  if (!Array.isArray(approvals)) {
    throw new ValidationError("Approvals must be an array of { userId, paymentId }");
  }

  const results = {
    successCount: 0,
    failures: []
  };

  for (const app of approvals) {
    try {
      await approvePayment(app.userId, app.paymentId, adminUserId);
      results.successCount++;
    } catch (err) {
      results.failures.push({
        userId: app.userId,
        paymentId: app.paymentId,
        error: err.message || "Failed to approve"
      });
    }
  }

  return results;
};

const { generateUserId } = require("../utils/idGenerator");

const createStudentByAdmin = async (data, adminUserId) => {
  const normalizedEmail = (data.email || "").toLowerCase().trim();
  if (!normalizedEmail) throw new ValidationError("Email is required");

  const existingUser = await User.findOne({ "basicInfo.email": normalizedEmail });
  if (existingUser) throw new ConflictError("A student account with this email already exists");

  const userId = await generateUserId();
  const password = data.password || "Viramah@123";
  const passwordHash = await bcrypt.hash(password, 10);

  const newUser = new User({
    basicInfo: {
      userId,
      residentId: userId,
      fullName: data.fullName,
      email: normalizedEmail,
      phone: data.phone || "",
      gender: data.gender || "male",
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
      address: data.address || "",
      salesAgent: adminUserId || "Admin Direct",
    },
    auth: {
      passwordHash,
    },
    verification: {
      emailVerified: true,
      phoneVerified: true,
      documentVerificationStatus: "verified",
    },
    profilePhoto: data.photoUrl ? { url: data.photoUrl, uploadedAt: new Date() } : undefined,
    guardianDetails: {
      fullName: data.guardianFullName || "",
      relation: data.guardianRelation || "",
      phone: data.guardianPhone || "",
      alternatePhone: data.guardianAlternatePhone || "",
      idProof: {
        idType: data.idType || "aadhaar",
        idNumber: data.idNumber || "",
        frontImage: data.idFrontUrl || "",
        backImage: data.idBackUrl || "",
      },
    },
    userIdProof: {
      idType: data.idType || "aadhaar",
      idNumber: data.idNumber || "",
      frontImage: data.idFrontUrl || "",
      backImage: data.idBackUrl || "",
    },
    roomDetails: {
      roomNumber: data.roomNumber || "",
      allocationDate: data.moveInDate ? new Date(data.moveInDate) : new Date(),
      status: "allocated",
    },
    paymentSummary: {
      roomRent: {
        appliedRoomRent: Number(data.appliedRoomRent) || 0,
        selectedPlan: "full",
        fullPaymentDiscountPct: 0,
      },
      securityDeposit: {
        amount: Number(data.securityDeposit) || 0,
      },
      registrationFee: {
        amount: Number(data.registrationFee) || 0,
      },
    },
    onboarding: {
      currentStep: "completed",
      isCompleted: true,
    },
    accountStatus: "active",
  });

  await newUser.save();
  await logAdminAction(adminUserId, "CREATE_STUDENT", `Created student profile ${userId} (${data.fullName})`);

  return { user: newUser, tempPassword: password };
};

// Export these functions too
module.exports.reconcileStatement = reconcileStatement;
module.exports.bulkApprovePayments = bulkApprovePayments;
module.exports.createStudentByAdmin = createStudentByAdmin;
module.exports.updateSecurityDeposit = updateSecurityDeposit;



