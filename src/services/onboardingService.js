const RoomType = require("../models/RoomType");
const PricingConfig = require("../models/PricingConfig");
const User = require("../models/User");
const { uploadToS3 } = require("../middleware/upload");
const {
  ValidationError,
  NotFoundError,
} = require("../utils/errors");

const DEFAULT_PRICING = {
  tenureMonths: 11,
  registrationFee: 1000,
  securityDeposit: 15000,
  mess: { monthlyFee: 2000, annualDiscountedPrice: 19900 },
  transport: { monthlyFee: 2000 },
  bookingPayment: { minimumAmount: 1000, suggestedAmount: 16000 },
  paymentDeadlineDays: 30,
};

const getOrCreatePricingConfig = async () => {
  let pricing = await PricingConfig.findOne();
  if (!pricing) {
    pricing = await PricingConfig.create(DEFAULT_PRICING);
  }
  return pricing;
};

const saveCompliance = async (user, data) => {
  const now = new Date();
  user.compliance.termsAccepted = !!data.termsAccepted;
  user.compliance.termsAcceptedAt = data.termsAccepted ? now : undefined;
  user.compliance.termsVersion = data.termsVersion || "1.0";
  user.compliance.privacyPolicyAccepted = !!data.privacyPolicyAccepted;
  user.compliance.privacyAcceptedAt = data.privacyPolicyAccepted ? now : undefined;
  user.compliance.privacyVersion = data.privacyVersion || "1.0";

  if (!user.compliance.termsAccepted || !user.compliance.privacyPolicyAccepted) {
    throw new ValidationError("Both terms and privacy policy must be accepted");
  }

  // Skip verification step — user already verified email at /verify-contact during signup
  user.onboarding.currentStep = "personal_details";
  await user.save();
  return { nextStep: "personal_details" };
};

const savePersonalDetails = async (user, data, files = {}) => {
  user.basicInfo.fullName = data.fullName;
  user.basicInfo.dateOfBirth = data.dateOfBirth;
  user.basicInfo.gender = data.gender;
  user.basicInfo.address = data.address;

  if (files.profilePhoto?.[0]) {
    const url = await uploadToS3(files.profilePhoto[0], `documents/${user.basicInfo.userId}/profile`);
    user.profilePhoto = { url, uploadedAt: new Date() };
  }

  if (!user.userIdProof) user.userIdProof = {};
  user.userIdProof.idType = data.idType;
  user.userIdProof.idNumber = data.idNumber;

  if (files.idFront?.[0]) {
    user.userIdProof.frontImage = await uploadToS3(
      files.idFront[0],
      `documents/${user.basicInfo.userId}/id`
    );
  }
  if (files.idBack?.[0]) {
    user.userIdProof.backImage = await uploadToS3(
      files.idBack[0],
      `documents/${user.basicInfo.userId}/id`
    );
  }

  if (!user.userIdProof.frontImage || !user.userIdProof.backImage) {
    throw new ValidationError("Both front and back images of the ID are required");
  }

  user.onboarding.currentStep = "guardian_details";
  await user.save();
  return { nextStep: "guardian_details" };
};

const saveGuardianDetails = async (user, data, files = {}) => {
  if (!user.guardianDetails) user.guardianDetails = {};
  user.guardianDetails.fullName = data.fullName;
  user.guardianDetails.relation = data.relation;
  user.guardianDetails.phone = data.phone;
  user.guardianDetails.alternatePhone = data.alternatePhone;

  if (!user.guardianDetails.idProof) user.guardianDetails.idProof = {};
  user.guardianDetails.idProof.idType = data.idType;
  user.guardianDetails.idProof.idNumber = data.idNumber;

  if (files.guardianIdFront?.[0]) {
    user.guardianDetails.idProof.frontImage = await uploadToS3(
      files.guardianIdFront[0],
      `documents/${user.basicInfo.userId}/guardian-id`
    );
  }
  if (files.guardianIdBack?.[0]) {
    user.guardianDetails.idProof.backImage = await uploadToS3(
      files.guardianIdBack[0],
      `documents/${user.basicInfo.userId}/guardian-id`
    );
  }

  if (!user.guardianDetails.idProof.frontImage || !user.guardianDetails.idProof.backImage) {
    throw new ValidationError("Guardian ID front and back images are required");
  }

  user.onboarding.currentStep = "room_selection";
  await user.save();
  return { nextStep: "room_selection" };
};

const computePaymentSummary = (roomType, pricing, includeMess, includeTransport, paymentPlan) => {
  const tenure = pricing.tenureMonths;
  const monthlyRoomPrice = roomType.basePrice; // Initializing at Rack Rate
  const rawRoomRent = monthlyRoomPrice * tenure;

  // Apply discount based on selected payment plan
  const fullDiscountPct = pricing.defaultFullPaymentDiscountPct ?? 40;
  const halfDiscountPct = pricing.defaultHalfPaymentDiscountPct ?? 25;

  let discountPct = 0;
  if (paymentPlan === "full") {
    discountPct = fullDiscountPct;
  } else if (paymentPlan === "half") {
    discountPct = halfDiscountPct;
  }

  const discountValue = Math.round(rawRoomRent * (discountPct / 100));
  const discountedRoomRent = rawRoomRent - discountValue;

  let messFee = 0;
  if (includeMess) {
    const annual = pricing.mess?.annualDiscountedPrice || 0;
    messFee = annual > 0 ? annual : (pricing.mess?.monthlyFee || 0) * tenure;
  }

  let transportFee = 0;
  if (includeTransport) {
    transportFee = (pricing.transport?.monthlyFee || 0) * tenure;
  }

  const registrationFee = pricing.registrationFee;
  const securityDeposit = pricing.securityDeposit;
  const grandTotalValue =
    registrationFee + securityDeposit + discountedRoomRent + messFee + transportFee;

  const entry = (total) => ({ total, paid: 0, remaining: total });

  return {
    registrationFee: entry(registrationFee),
    securityDeposit: entry(securityDeposit),
    roomRent: {
      total: discountedRoomRent,
      paid: 0,
      remaining: discountedRoomRent,
      fullPaymentDiscountPct: fullDiscountPct,
      halfPaymentDiscountPct: halfDiscountPct,
      appliedDiscountValue: discountValue,
      selectedPlan: paymentPlan,
    },
    messFee: entry(messFee),
    transportFee: entry(transportFee),
    grandTotal: entry(grandTotalValue),
    isFullyPaid: false,
  };
};

const saveRoomSelection = async (user, data) => {
  const roomType = await RoomType.findById(data.roomTypeId);
  if (!roomType || !roomType.isActive) {
    throw new NotFoundError("Room type not found");
  }

  const pricing = await getOrCreatePricingConfig();

  user.roomDetails.roomType = roomType._id;
  user.roomDetails.includeMess = !!data.includeMess;
  user.roomDetails.includeTransport = !!data.includeTransport;

  user.paymentSummary = computePaymentSummary(
    roomType,
    pricing,
    user.roomDetails.includeMess,
    user.roomDetails.includeTransport,
    data.paymentPlan
  );

  user.onboarding.currentStep = "review";
  await user.save();
  return { nextStep: "review", paymentSummary: user.paymentSummary };
};

const getReview = async (user) => {
  const freshUser = await User.findById(user._id).populate("roomDetails.roomType");
  if (!freshUser) throw new NotFoundError("User not found");
  const pricing = await getOrCreatePricingConfig();
  return {
    user: freshUser,
    pricing,
  };
};

const confirmReview = async (user) => {
  // Re-fetch to guarantee a Mongoose document (req.user can lose its prototype).
  const freshUser = await User.findById(user._id);
  if (!freshUser) throw new NotFoundError("User not found");
  freshUser.onboarding.currentStep = "booking_payment";
  await freshUser.save();
  return { nextStep: "booking_payment" };
};

const savePhone = async (user, data) => {
  const { phone } = data;
  if (!phone || typeof phone !== "string") {
    throw new ValidationError("Phone number is required");
  }
  
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length < 10) {
    throw new ValidationError("Phone number must be at least 10 digits");
  }

  const freshUser = await User.findById(user._id);
  if (!freshUser) throw new NotFoundError("User not found");
  freshUser.basicInfo.phone = phone;
  await freshUser.save();
  return { phone: freshUser.basicInfo.phone, message: "Phone number saved successfully" };
};

module.exports = {
  saveCompliance,
  savePersonalDetails,
  saveGuardianDetails,
  saveRoomSelection,
  getReview,
  confirmReview,
  savePhone,
};
