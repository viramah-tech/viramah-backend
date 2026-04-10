/**
 * Seed script: populates the RoomType collection with canonical room types.
 *
 * Usage:
 *   node src/scripts/seedRooms.js
 *
 * Requires MONGODB_URI in .env (loads from project root).
 */

const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const connectDB = require('../config/db');
const RoomType = require('../models/RoomType');

const roomTypes = [
  {
    name: 'NEXUS',
    displayName: 'VIRAMAH Nexus',
    capacity: 'Single Occupancy',
    totalRooms: 10,
    bedsPerRoom: 1,
    totalBeds: 10,
    availableSeats: 10,
    bookedSeats: 0,
    pricing: { original: 9000, discounted: 8500 },
    features: ['AC', 'Attached Bathroom', 'WiFi', 'Power Backup'],
    images: [],
    isActive: true,
  },
  {
    name: 'AXIS',
    displayName: 'VIRAMAH Axis',
    capacity: 'Double Sharing',
    totalRooms: 12,
    bedsPerRoom: 2,
    totalBeds: 24,
    availableSeats: 24,
    bookedSeats: 0,
    pricing: { original: 6500, discounted: 6000 },
    features: ['AC', 'Attached Bathroom', 'WiFi', 'Housekeeping'],
    images: [],
    isActive: true,
  },
  {
    name: 'COLLECTIVE',
    displayName: 'VIRAMAH Collective',
    capacity: 'Triple Sharing',
    totalRooms: 8,
    bedsPerRoom: 3,
    totalBeds: 24,
    availableSeats: 24,
    bookedSeats: 0,
    pricing: { original: 5500, discounted: 5000 },
    features: ['WiFi', 'Common Washroom', 'Power Backup'],
    images: [],
    isActive: true,
  },
  {
    name: 'AXIS+',
    displayName: 'VIRAMAH Axis+',
    capacity: 'Premium Double Sharing',
    totalRooms: 6,
    bedsPerRoom: 2,
    totalBeds: 12,
    availableSeats: 12,
    bookedSeats: 0,
    pricing: { original: 7800, discounted: 7300 },
    features: ['Premium Interior', 'AC', 'Attached Bathroom', 'WiFi'],
    images: [],
    isActive: true,
  },
];

const seed = async () => {
  try {
    await connectDB();
    console.log('Connected to database.');

    let created = 0;
    let updated = 0;

    for (const payload of roomTypes) {
      const existing = await RoomType.findOne({ name: payload.name }).lean();
      if (existing) {
        await RoomType.updateOne({ name: payload.name }, { $set: payload });
        updated += 1;
      } else {
        await RoomType.create(payload);
        created += 1;
      }
    }

    console.log(`RoomType seed complete. Created: ${created}, Updated: ${updated}.`);
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
};

seed();
