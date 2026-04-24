const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const PricingConfig = require("../models/PricingConfig");
const { bucketName } = require("../config/s3");
const {
  ValidationError,
  ConflictError,
  AppError,
} = require("../utils/errors");
const { logPaymentAudit } = require("../utils/auditLogger");

const CATEGORY_MAP = {
  room_rent: "roomRent",
  mess: "messFee",
  transport: "transportFee",
  security_deposit: "securityDeposit",
};

const ALLOWED_PAYMENT_METHODS = ["upi", "bank_transfer", "cash"];
const DEFAULT_ALLOWED_PROOF_HOSTS = [
  "viramah.s3.amazonaws.com",
  "localhost",
  "localhost:3000",
  "127.0.0.1",
  "127.0.0.1:3000",
];

const normalizeAllowedHost = (value) => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    // Accept full URLs in env values and extract only host/hostname.
    const parsed = new URL(trimmed);
    return parsed.host.toLowerCase();
  } catch {
    try {
      // Also accept scheme-less values like bucket.s3.amazonaws.com/path.
      const parsed = new URL(`https://${trimmed}`);
      return parsed.host.toLowerCase();
    } catch {
      return trimmed.replace(/^\/+|\/+$/g, "").toLowerCase();
    }
  }
};

const dedupeHosts = (hosts) => {
  const unique = new Set();
  for (const host of hosts) {
    const normalized = normalizeAllowedHost(host);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
};

const region = process.env.AWS_REGION || "ap-south-1";
const derivedBucketHosts = bucketName
  ? [
      `${bucketName}.s3.${region}.amazonaws.com`,
      `${bucketName}.s3.amazonaws.com`,
    ]
  : [];

const configuredAllowedHosts = (process.env.S3_BUCKET_HOST || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const cloudfrontHost = process.env.AWS_CLOUDFRONT_DOMAIN || "";

const ALLOWED_PROOF_HOSTS = dedupeHosts([
  ...configuredAllowedHosts,
  ...derivedBucketHosts,
  cloudfrontHost,
  ...DEFAULT_ALLOWED_PROOF_HOSTS,
]);

const matchesAllowedHost = (url, allowedHost) => {
  const normalized = allowedHost.trim().toLowerCase();
  if (!normalized) return false;

  // If host includes port, compare against URL.host. Otherwise compare hostname only.
  if (normalized.includes(":")) {
    return url.host.toLowerCase() === normalized;
  }

  return url.hostname.toLowerCase() === normalized;
};

/**
 * Validate payment proof URL - must be from trusted S3 bucket
 */
const validateProofUrl = (proofUrl) => {
  try {
    const url = new URL(proofUrl);
    const isAllowed = ALLOWED_PROOF_HOSTS.some((host) => matchesAllowedHost(url, host));
    if (!isAllowed) {
      throw new ValidationError("Payment proof URL must be from authorized storage");
    }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new ValidationError("Payment proof URL must use HTTPS");
    }
    return true;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError("Invalid payment proof URL format");
  }
};

/**
 * Validate payment method
 */
const validatePaymentMethod = (method) => {
  if (!ALLOWED_PAYMENT_METHODS.includes(method)) {
    throw new ValidationError(`Payment method must be one of: ${ALLOWED_PAYMENT_METHODS.join(", ")}`);
  }
};

/**
 * Validate transaction ID
 */
const validateTransactionId = (transactionId) => {
  if (!transactionId || typeof transactionId !== "string" || transactionId.trim().length === 0) {
    throw new ValidationError("Transaction ID is required");
  }
  if (transactionId.length > 100) {
    throw new ValidationError("Transaction ID is too long (max 100 characters)");
  }
};

// hasPending function removed to allow multiple simultaneous payments

const getEffectiveDeadline = (paymentDeadline) => {
  if (!paymentDeadline) return null;
  const deadline = paymentDeadline.extensionGrantedUntil || paymentDeadline.expiresAt;
  return deadline ? new Date(deadline) : null;
};

const getBookingFinancials = (user) => {
  const registrationFeePaid = Number(user.paymentSummary?.registrationFee?.paid ?? 0);
  const securityDepositPaid = Number(user.paymentSummary?.securityDeposit?.paid ?? 0);
  const approvedBookingTotal = (user.paymentDetails || [])
    .filter((payment) => payment.paymentType === "booking" && payment.status === "approved")
    .reduce((sum, payment) => sum + Number(payment.amounts?.totalAmount ?? 0), 0);

  const advanceAmount = Math.max(0, approvedBookingTotal - registrationFeePaid - securityDepositPaid);
  const refundableAmount = securityDepositPaid + advanceAmount;

  return {
    approvedBookingTotal,
    registrationFeePaid,
    securityDepositPaid,
    advanceAmount,
    refundableAmount,
  };
};

const submitBookingPayment = async (user, data) => {
  if (user.onboarding.currentStep !== "booking_payment") {
    throw new ValidationError("User is not at the booking payment step");
  }

  validatePaymentMethod(data.method);
  validateTransactionId(data.transactionId);
  validateProofUrl(data.proofUrl);

  const amount = Number(data.amount);
  if (Number.isNaN(amount) || amount <= 0) {
    throw new ValidationError("Payment amount must be a positive number");
  }

  const pricing = await PricingConfig.findOne();
  if (!pricing) throw new AppError("Pricing configuration missing", 500, "PRICING_MISSING");

  if (amount < pricing.bookingPayment.minimumAmount) {
    throw new ValidationError(
      `Minimum booking payment is ₹${pricing.bookingPayment.minimumAmount}`
    );
  }
  if (amount > user.paymentSummary.grandTotal.remaining) {
    throw new ValidationError("Amount exceeds total outstanding balance");
  }

  const paymentId = uuidv4();
  const paymentSignature = crypto
    .createHmac("sha256", process.env.PAYMENT_SIGNATURE_SECRET || "dev-secret")
    .update(`${user.basicInfo.userId}:${paymentId}:${amount}:${Date.now()}`)
    .digest("hex");

  user.paymentDetails.push({
    paymentId,
    paymentType: "booking",
    category: "booking",
    method: data.method,
    transactionId: data.transactionId,
    proof: { url: data.proofUrl, uploadedAt: new Date() },
    amounts: { totalAmount: amount },
    breakdown: { registrationFee: 0, securityDeposit: 0, roomRent: 0, messFee: 0, transportFee: 0 },
    status: "pending",
    signature: paymentSignature,
    paidAt: new Date(),
  });

  await user.save();
  
  logPaymentAudit("SUBMITTED", user.basicInfo.userId, paymentId, amount, {
    method: data.method,
    type: "booking",
  });
  
  return user.paymentDetails[user.paymentDetails.length - 1];
};

const submitFinalPayment = async (user, data) => {
  if (user.onboarding.currentStep !== "final_payment" && user.onboarding.currentStep !== "completed") {
    throw new ValidationError("User is not at the final payment step or completed step");
  }

  validatePaymentMethod(data.method);
  validateTransactionId(data.transactionId);
  validateProofUrl(data.proofUrl);

  const summaryKey = CATEGORY_MAP[data.category];
  if (!summaryKey) throw new ValidationError("Invalid payment category");

  const amount = Number(data.amount);
  if (Number.isNaN(amount) || amount <= 0) {
    throw new ValidationError("Payment amount must be a positive number");
  }

  let categoryRemaining = user.paymentSummary[summaryKey].remaining;

  if (data.category === "room_rent" && user.paymentSummary.roomRent.selectedPlan === "pending") {
    throw new ValidationError("Payment plan must be selected during room selection. Please go back and select your room again.");
  }

  if (categoryRemaining <= 0) {
    throw new ValidationError(`No dues remaining for ${data.category}`);
  }

  // Mess and transport must be paid in full
  if ((data.category === "mess" || data.category === "transport") && amount !== categoryRemaining) {
    throw new ValidationError(
      `${data.category} must be paid in full. Outstanding: ₹${categoryRemaining}`
    );
  }

  let paymentType = "full";
  if (data.category === "room_rent") {
    if (amount > categoryRemaining) {
      throw new ValidationError("Amount exceeds outstanding room rent balance.");
    }
    
    // Classify whether it's full or half roughly, mostly for logging clarity
    if (amount === categoryRemaining) {
        paymentType = "full";
    } else {
        paymentType = "half";
    }
  } else {
    if (amount > categoryRemaining) {
      throw new ValidationError(`Amount exceeds outstanding balance for ${data.category}`);
    }
    paymentType = amount === categoryRemaining ? "full" : "half";
  }
  const breakdown = { registrationFee: 0, securityDeposit: 0, roomRent: 0, messFee: 0, transportFee: 0 };
  breakdown[summaryKey] = amount;

  const paymentId = uuidv4();
  const paymentSignature = crypto
    .createHmac("sha256", process.env.PAYMENT_SIGNATURE_SECRET || "dev-secret")
    .update(`${user.basicInfo.userId}:${paymentId}:${amount}:${Date.now()}`)
    .digest("hex");

  user.paymentDetails.push({
    paymentId,
    paymentType,
    category: data.category,
    method: data.method,
    transactionId: data.transactionId,
    proof: { url: data.proofUrl, uploadedAt: new Date() },
    amounts: { totalAmount: amount },
    breakdown,
    status: "pending",
    signature: paymentSignature,
    paidAt: new Date(),
  });

  await user.save();
  
  logPaymentAudit("SUBMITTED", user.basicInfo.userId, paymentId, amount, {
    method: data.method,
    type: data.category,
  });
  
  return user.paymentDetails[user.paymentDetails.length - 1];
};

const requestPaymentDeadlineExtension = async (user, data = {}) => {
  if (user.onboarding.currentStep !== "final_payment") {
    throw new ValidationError("Deadline extension can be requested only during final payment stage");
  }

  const existing = user.paymentDeadline || {};
  const effectiveDeadline = getEffectiveDeadline(existing);
  if (!effectiveDeadline) {
    throw new ValidationError("No active payment deadline found");
  }
  if (effectiveDeadline.getTime() < Date.now()) {
    throw new ValidationError("Payment deadline has already expired");
  }
  if (existing.extensionRequested) {
    throw new ConflictError("Deadline extension has already been requested");
  }

  user.paymentDeadline = {
    ...(existing.toObject ? existing.toObject() : existing),
    extensionRequested: true,
    extensionRequestedAt: new Date(),
    extensionReason: (data.reason || "").trim() || undefined,
  };

  await user.save();

  logPaymentAudit("EXTENSION_REQUESTED", user.basicInfo.userId, "extension-request", 0, {
    reason: user.paymentDeadline.extensionReason,
  });

  return {
    extensionRequested: true,
    extensionRequestedAt: user.paymentDeadline.extensionRequestedAt,
    paymentDeadline: effectiveDeadline,
  };
};

const requestBookingRefund = async (user, data = {}) => {
  if (user.onboarding.currentStep !== "final_payment") {
    throw new ValidationError("Refund request is allowed only after booking approval");
  }
  if (user.paymentSummary?.isFullyPaid) {
    throw new ConflictError("Booking refund is not allowed after full payment completion");
  }

  const hasApprovedBooking = (user.paymentDetails || []).some(
    (payment) => payment.paymentType === "booking" && payment.status === "approved"
  );
  if (!hasApprovedBooking) {
    throw new ValidationError("Refund request is allowed only after booking payment approval");
  }

  const existing = user.paymentDeadline || {};
  if (existing.refundRequestedAt) {
    throw new ConflictError("Refund has already been requested for this booking");
  }

  const effectiveDeadline = getEffectiveDeadline(existing);
  if (effectiveDeadline && effectiveDeadline.getTime() < Date.now()) {
    throw new ValidationError("Refund window has closed for this booking");
  }

  const bookingFinancials = getBookingFinancials(user);
  if (bookingFinancials.refundableAmount <= 0) {
    throw new ValidationError("No refundable amount is available for this booking");
  }

  const now = new Date();
  user.paymentDeadline = {
    ...(existing.toObject ? existing.toObject() : existing),
    refundRequestedAt: now,
    refundReason: (data.reason || "").trim() || undefined,
    cancellationRequestedAt: now,
    cancellationReason: (data.reason || "").trim() || undefined,
  };
  user.onboarding.currentStep = "booking_payment";

  await user.save();

  logPaymentAudit(
    "REFUND_REQUESTED",
    user.basicInfo.userId,
    "refund-request",
    bookingFinancials.refundableAmount,
    { reason: user.paymentDeadline.refundReason }
  );

  return {
    refundRequestedAt: user.paymentDeadline.refundRequestedAt,
    refundableAmount: bookingFinancials.refundableAmount,
    registrationFeeNonRefundable: bookingFinancials.registrationFeePaid,
  };
};

const requestBookingCancellation = async (user, data = {}) => {
  if (!["booking_payment", "final_payment"].includes(user.onboarding.currentStep)) {
    throw new ValidationError("Booking cancellation is not allowed at this stage");
  }
  if (user.paymentSummary?.isFullyPaid) {
    throw new ConflictError("Booking cancellation is not allowed after full payment completion");
  }

  const existing = user.paymentDeadline || {};
  if (existing.cancellationRequestedAt) {
    throw new ConflictError("Cancellation has already been requested for this booking");
  }

  user.paymentDeadline = {
    ...(existing.toObject ? existing.toObject() : existing),
    cancellationRequestedAt: new Date(),
    cancellationReason: (data.reason || "").trim() || undefined,
  };
  user.onboarding.currentStep = "booking_payment";

  await user.save();

  logPaymentAudit("CANCELLATION_REQUESTED", user.basicInfo.userId, "cancel-request", 0, {
    reason: user.paymentDeadline.cancellationReason,
  });

  return {
    cancellationRequestedAt: user.paymentDeadline.cancellationRequestedAt,
  };
};

const upgradePaymentPlan = async (user) => {
  if (user.paymentSummary.roomRent.selectedPlan !== "half") {
    throw new ValidationError("Only users on the part payment plan can upgrade to the full plan.");
  }
  
  if (user.paymentSummary.isFullyPaid) {
    throw new ConflictError("Payments are already fully completed.");
  }

  const currentTotal = user.paymentSummary.roomRent.total;
  const currentAppliedDiscount = user.paymentSummary.roomRent.appliedDiscountValue || 0;
  
  // Back-calculate the raw rack rate room rent before the half discount
  const rawRoomRent = currentTotal + currentAppliedDiscount;

  // Apply the new full discount
  const fullDiscountPct = user.paymentSummary.roomRent.fullPaymentDiscountPct || 40;
  const newDiscountValue = Math.round(rawRoomRent * (fullDiscountPct / 100));
  const newTotal = rawRoomRent - newDiscountValue;
  
  const discountDifference = newDiscountValue - currentAppliedDiscount;

  // Update roomRent ledger
  user.paymentSummary.roomRent.selectedPlan = "full";
  user.paymentSummary.roomRent.appliedDiscountValue = newDiscountValue;
  user.paymentSummary.roomRent.total = newTotal;
  user.paymentSummary.roomRent.remaining -= discountDifference;
  
  // Update grandTotal ledger
  user.paymentSummary.grandTotal.total -= discountDifference;
  user.paymentSummary.grandTotal.remaining -= discountDifference;

  // Prevent negative balances if there's any odd case
  user.paymentSummary.roomRent.remaining = Math.max(0, user.paymentSummary.roomRent.remaining);
  user.paymentSummary.grandTotal.remaining = Math.max(0, user.paymentSummary.grandTotal.remaining);

  await user.save();

  logPaymentAudit("PLAN_UPGRADED", user.basicInfo.userId, "upgrade", 0, {
    oldDiscount: currentAppliedDiscount,
    newDiscount: newDiscountValue
  });

  return { 
    success: true, 
    newTotal, 
    newRemaining: user.paymentSummary.roomRent.remaining,
    discountValue: newDiscountValue
  };
};

const getPaymentStatus = async (user) => {
  const bookingFinancials = getBookingFinancials(user);
  return {
    paymentDetails: user.paymentDetails,
    paymentSummary: user.paymentSummary,
    paymentDeadline: user.paymentDeadline,
    lifecycle: {
      extensionRequested: Boolean(user.paymentDeadline?.extensionRequested),
      extensionRequestedAt: user.paymentDeadline?.extensionRequestedAt || null,
      extensionGrantedUntil: user.paymentDeadline?.extensionGrantedUntil || null,
      refundRequestedAt: user.paymentDeadline?.refundRequestedAt || null,
      cancellationRequestedAt: user.paymentDeadline?.cancellationRequestedAt || null,
    },
    bookingFinancials,
  };
};

module.exports = {
  submitBookingPayment,
  submitFinalPayment,
  requestPaymentDeadlineExtension,
  requestBookingRefund,
  requestBookingCancellation,
  getPaymentStatus,
  upgradePaymentPlan,
};
