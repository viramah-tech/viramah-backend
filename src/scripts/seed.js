require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const connectDB = require("../config/db");
const RoomType = require("../models/RoomType");
const PricingConfig = require("../models/PricingConfig");
const User = require("../models/User");
const { generateUserId } = require("../utils/idGenerator");

const ROOM_TYPES = [
  {
    name: "Axis+",
    capacity: 1,
    basePrice: 12000,
    features: ["AC", "Attached Bath", "Balcony", "Study Desk"],
    totalRooms: 10,
    availableRooms: 10,
    bedsPerRoom: 1,
    totalBeds: 10,
    availableSeats: 10,
  },
  {
    name: "Axis",
    capacity: 2,
    basePrice: 10000,
    features: ["AC", "Attached Bath"],
    totalRooms: 20,
    availableRooms: 20,
    bedsPerRoom: 2,
    totalBeds: 40,
    availableSeats: 40,
  },
  {
    name: "Collective",
    capacity: 3,
    basePrice: 8000,
    features: ["AC", "Common Bath"],
    totalRooms: 30,
    availableRooms: 30,
    bedsPerRoom: 3,
    totalBeds: 90,
    availableSeats: 90,
  },
  {
    name: "Nexus",
    capacity: 4,
    basePrice: 6000,
    features: ["Fan", "Common Bath"],
    totalRooms: 40,
    availableRooms: 40,
    bedsPerRoom: 4,
    totalBeds: 160,
    availableSeats: 160,
  },
];

const DEFAULT_PRICING = {
  tenureMonths: 11,
  registrationFee: 1000,
  securityDeposit: 15000,
  mess: { monthlyFee: 2000, annualDiscountedPrice: 19900 },
  transport: { monthlyFee: 2000 },
  bookingPayment: { minimumAmount: 1000, suggestedAmount: 16000 },
  paymentDeadlineDays: 30,
};

const seedPricing = async () => {
  const existing = await PricingConfig.findOne();
  if (existing) {
    Object.assign(existing, DEFAULT_PRICING);
    await existing.save();
    console.log("[seed] PricingConfig updated");
  } else {
    await PricingConfig.create(DEFAULT_PRICING);
    console.log("[seed] PricingConfig created");
  }
};

const seedRoomTypes = async () => {
  for (const rt of ROOM_TYPES) {
    const existing = await RoomType.findOne({ name: rt.name });
    if (existing) {
      Object.assign(existing, rt);
      await existing.save();
      console.log(`[seed] RoomType updated: ${rt.name}`);
    } else {
      await RoomType.create(rt);
      console.log(`[seed] RoomType created: ${rt.name}`);
    }
  }
};

const seedAdmin = async () => {
  const email = (process.env.ADMIN_EMAIL || "admin@viramah.com").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const phone = process.env.ADMIN_PHONE || "9999999999";

  const existing = await User.findOne({ "basicInfo.email": email });
  if (existing) {
    console.log(`[seed] Admin user already exists: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = "ADMIN";

  await User.create({
    basicInfo: {
      userId,
      fullName: "Viramah Admin",
      email,
      phone,
    },
    auth: { passwordHash },
    role: "admin",
    accountStatus: "active",
    onboarding: { currentStep: "completed", startedAt: new Date(), completedAt: new Date() },
    verification: { emailVerified: true, phoneVerified: true },
  });
  console.log(`[seed] Admin user created: ${email} / ${password}`);
};

const run = async () => {
  await connectDB();
  await seedPricing();
  await seedRoomTypes();
  await seedAdmin();
  await mongoose.connection.close();
  console.log("[seed] Done.");
};

run().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
