/**
 * Seed script: populates the Room collection with initial room data.
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
const Room = require('../models/Room');

const rooms = [
  // VIRAMAH Nexus — Single rooms (2nd floor)
  {
    roomNumber: '201', floor: 2, roomType: 'VIRAMAH Nexus', occupancyType: 'single',
    capacity: 1, pricePerMonth: 8500, securityDeposit: 17000,
    amenities: { wifi: true, ac: true, attachedBathroom: true, powerBackup: true },
    size: 180, facing: 'east', furniture: 'fully-furnished',
  },
  {
    roomNumber: '202', floor: 2, roomType: 'VIRAMAH Nexus', occupancyType: 'single',
    capacity: 1, pricePerMonth: 9000, securityDeposit: 18000,
    amenities: { wifi: true, ac: true, attachedBathroom: true, powerBackup: true },
    size: 200, facing: 'south', furniture: 'fully-furnished',
  },
  {
    roomNumber: '203', floor: 2, roomType: 'VIRAMAH Nexus', occupancyType: 'single',
    capacity: 1, pricePerMonth: 8000, securityDeposit: 16000,
    amenities: { wifi: true, ac: true, attachedBathroom: false, powerBackup: true },
    size: 160, facing: 'north', furniture: 'fully-furnished',
  },

  // VIRAMAH Axis — Double sharing (1st floor)
  {
    roomNumber: '101', floor: 1, roomType: 'VIRAMAH Axis', occupancyType: 'double',
    capacity: 2, pricePerMonth: 6000, securityDeposit: 12000,
    amenities: { wifi: true, ac: true, attachedBathroom: true, powerBackup: true },
    size: 250, facing: 'east', furniture: 'furnished',
  },
  {
    roomNumber: '102', floor: 1, roomType: 'VIRAMAH Axis', occupancyType: 'double',
    capacity: 2, pricePerMonth: 5500, securityDeposit: 11000,
    amenities: { wifi: true, ac: false, attachedBathroom: true, powerBackup: true },
    size: 230, facing: 'west', furniture: 'furnished',
  },
  {
    roomNumber: '103', floor: 1, roomType: 'VIRAMAH Axis', occupancyType: 'double',
    capacity: 2, pricePerMonth: 7000, securityDeposit: 14000,
    amenities: { wifi: true, ac: true, attachedBathroom: true, powerBackup: true },
    size: 260, facing: 'south', furniture: 'fully-furnished',
  },

  // VIRAMAH Collective — Triple sharing (ground floor)
  {
    roomNumber: '001', floor: 0, roomType: 'VIRAMAH Collective', occupancyType: 'triple',
    capacity: 3, pricePerMonth: 5000, securityDeposit: 10000,
    amenities: { wifi: true, ac: false, attachedBathroom: false, powerBackup: true },
    size: 320, facing: 'north', furniture: 'semi-furnished',
  },
  {
    roomNumber: '002', floor: 0, roomType: 'VIRAMAH Collective', occupancyType: 'triple',
    capacity: 3, pricePerMonth: 5000, securityDeposit: 10000,
    amenities: { wifi: true, ac: false, attachedBathroom: false, powerBackup: true },
    size: 300, facing: 'east', furniture: 'semi-furnished',
  },

  // VIRAMAH Axis+ — Premium double sharing (3rd floor)
  {
    roomNumber: '301', floor: 3, roomType: 'VIRAMAH Axis+', occupancyType: 'double',
    capacity: 2, pricePerMonth: 7500, securityDeposit: 15000,
    amenities: { wifi: true, ac: true, attachedBathroom: true, powerBackup: true },
    size: 280, facing: 'south', furniture: 'fully-furnished',
  },
  {
    roomNumber: '302', floor: 3, roomType: 'VIRAMAH Axis+', occupancyType: 'double',
    capacity: 2, pricePerMonth: 7000, securityDeposit: 14000,
    amenities: { wifi: true, ac: true, attachedBathroom: true, powerBackup: true },
    size: 270, facing: 'west', furniture: 'fully-furnished',
  },
];

const seed = async () => {
  try {
    await connectDB();
    console.log('Connected to database.');

    const existing = await Room.countDocuments();
    if (existing > 0) {
      console.log(`Room collection already has ${existing} documents. Skipping seed.`);
      console.log('To re-seed, drop the rooms collection first: db.rooms.drop()');
      process.exit(0);
    }

    const result = await Room.insertMany(rooms);
    console.log(`Seeded ${result.length} rooms successfully.`);
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
};

seed();
