const User = require("../models/User");
const RoomType = require("../models/RoomType");
const PricingConfig = require("../models/PricingConfig");
const { allocateWaterfall } = require("../utils/waterfall");
const {
  NotFoundError,
  ValidationError,
  ConflictError,
} = require("../utils/errors");
const crypto = require("crypto");
const { logPaymentAudit, logAdminAction } = require("../utils/auditLogger");
const { sendPaymentReceiptEmail } = require("./emailService");

const CATEGORY_KEYS = [
  "registrationFee",
  "securityDeposit",
  "roomRent",
  "messFee",
  "transportFee",
];

const getUsers = async ({ status, step, page = 1, limit = 20 }) => {
  const query = {};
  if (status) query.accountStatus = status;
  if (step) query["onboarding.currentStep"] = step;

  const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  const [users, total] = await Promise.all([
    User.find(query)
      .select("-auth.passwordHash -verification.otp")
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

const updateRoomRentDiscounts = async (userId, fullPaymentDiscountPct, halfPaymentDiscountPct, customRackRate) => {
  const user = await User.findOne({ "basicInfo.userId": userId }).populate("roomDetails.roomType");
  if (!user) throw new NotFoundError("User not found");

  if (typeof fullPaymentDiscountPct === "number") {
    user.paymentSummary.roomRent.fullPaymentDiscountPct = fullPaymentDiscountPct;
  }
  if (typeof halfPaymentDiscountPct === "number") {
    user.paymentSummary.roomRent.halfPaymentDiscountPct = halfPaymentDiscountPct;
  }
  if (typeof customRackRate === "number") {
    user.paymentSummary.roomRent.customRackRate = customRackRate;
  }

  // Recalculate if user has already done room selection and selected a plan
  const plan = user.paymentSummary?.roomRent?.selectedPlan;
  if (plan === "full" || plan === "half") {
    const pricing = await PricingConfig.findOne();
    const tenure = pricing?.tenureMonths || 11;
    const roomPrice = user.roomDetails?.roomType?.basePrice || 0;
    
    // Use customRackRate if provided, otherwise fallback to standard calculation
    const rawRoomRent = typeof user.paymentSummary.roomRent.customRackRate === "number" 
      ? user.paymentSummary.roomRent.customRackRate 
      : (roomPrice * tenure);

    const discountPct = plan === "full" ? user.paymentSummary.roomRent.fullPaymentDiscountPct : user.paymentSummary.roomRent.halfPaymentDiscountPct;
    
    const newDiscountValue = Math.round(rawRoomRent * (discountPct / 100));
    const oldDiscountValue = user.paymentSummary.roomRent.appliedDiscountValue || 0;
    const discountDifference = newDiscountValue - oldDiscountValue;

    user.paymentSummary.roomRent.appliedDiscountValue = newDiscountValue;
    user.paymentSummary.roomRent.total -= discountDifference;
    user.paymentSummary.roomRent.remaining -= discountDifference;
    
    user.paymentSummary.grandTotal.total -= discountDifference;
    user.paymentSummary.grandTotal.remaining -= discountDifference;

    // Prevent negative balances
    user.paymentSummary.roomRent.remaining = Math.max(0, user.paymentSummary.roomRent.remaining);
    user.paymentSummary.grandTotal.remaining = Math.max(0, user.paymentSummary.grandTotal.remaining);

    // If fully paid state changes
    user.paymentSummary.isFullyPaid = user.paymentSummary.grandTotal.remaining <= 0;
  }

  await user.save();
  return user.paymentSummary.roomRent;
};

const getPayments = async (statusFilter) => {
  const query = statusFilter ? { "paymentDetails.status": statusFilter } : { "paymentDetails": { $exists: true, $not: {$size: 0} } };

  const users = await User.find(query)
    .select(
      "basicInfo.userId basicInfo.fullName basicInfo.email basicInfo.phone paymentDetails paymentSummary"
    )
    .sort({ "paymentDetails.paidAt": -1 });

  const paymentsList = [];
  for (const u of users) {
    for (const p of u.paymentDetails) {
      if (!statusFilter || p.status === statusFilter) {
        paymentsList.push({
          userId: u.basicInfo?.userId || 'UNKNOWN_ID',
          fullName: u.basicInfo?.fullName || 'Unknown User',
          email: u.basicInfo?.email || 'N/A',
          phone: u.basicInfo?.phone || 'N/A',
          payment: p,
        });
      }
    }
  }
  
  paymentsList.sort((a,b) => (new Date(b.payment.paidAt || 0) - new Date(a.payment.paidAt || 0)));
  return paymentsList;
};

const applyBreakdown = (summary, breakdown) => {
  let totalApplied = 0;
  for (const key of CATEGORY_KEYS) {
    const amount = breakdown[key] || 0;
    if (amount <= 0) continue;
    const entry = summary[key];
    if (!entry) continue;
    if (amount > entry.remaining) {
      throw new ValidationError(`Breakdown exceeds remaining for ${key}`);
    }
    entry.paid += amount;
    entry.remaining -= amount;
    totalApplied += amount;
  }
  summary.grandTotal.paid += totalApplied;
  summary.grandTotal.remaining -= totalApplied;
  summary.isFullyPaid = summary.grandTotal.remaining === 0;
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
  if (payment.status !== "pending") {
    throw new ConflictError(`Payment already ${payment.status}`);
  }

  let breakdown;
  if (payment.paymentType === "booking") {
    breakdown = allocateWaterfall(payment.amounts.totalAmount, user.paymentSummary);
    payment.breakdown = breakdown;
  } else {
    breakdown = payment.breakdown;
  }

  applyBreakdown(user.paymentSummary, breakdown);

  payment.status = "approved";
  payment.reviewedBy = adminUserId;
  payment.reviewedAt = new Date();
  payment.approvalSignature = crypto
    .createHmac("sha256", process.env.PAYMENT_SIGNATURE_SECRET || "dev-secret")
    .update(`${adminUserId}:${paymentId}:APPROVED:${Date.now()}`)
    .digest("hex");

  // First approved booking payment starts the deadline clock
  if (payment.paymentType === "booking") {
    const pricing = await PricingConfig.findOne();
    const days = pricing?.paymentDeadlineDays || 30;
    const startedAt = new Date();
    user.paymentDeadline = {
      ...(user.paymentDeadline?.toObject ? user.paymentDeadline.toObject() : {}),
      startedAt,
      expiresAt: new Date(startedAt.getTime() + days * 24 * 60 * 60 * 1000),
    };

    if (user.onboarding.currentStep === "booking_payment") {
      user.onboarding.currentStep = "final_payment";
    }
  }

  if (user.paymentSummary.isFullyPaid) {
    user.onboarding.currentStep = "completed";
    user.onboarding.completedAt = new Date();
    user.accountStatus = "active";
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
  if (payment.status !== "pending") {
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
      { $match: { role: "user" } },
      { $group: { _id: null, total: { $sum: "$paymentSummary.grandTotal.paid" } } },
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
  user.accountStatus = "active";
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
};
