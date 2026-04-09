'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const RoomHold = require('../models/RoomHold');
const Booking = require('../models/Booking');
const User = require('../models/User');

const mapStatus = (roomHoldStatus) => {
  switch (roomHoldStatus) {
    case 'pending_approval': return 'UNDER_VERIFICATION';
    case 'active': return 'FINAL_PAYMENT_PENDING';
    case 'converted': return 'CLOSED'; // or 'FULLY_PAID' depending on phase, but CLOSED is safer for old holds
    case 'refunded': return 'REFUND_PROCESSING'; // or CLOSED
    case 'expired': return 'OVERDUE';
    default: return 'DRAFT';
  }
};

const mapPaymentMode = (mode) => {
  switch (mode) {
    case 'full': return 'FULL_TENURE';
    case 'half': return 'HALF_YEARLY';
    default: return null;
  }
};

const runMigration = async () => {
  try {
    await connectDB();
    console.log('Connected to DB...');

    const isDryRun = process.argv.includes('--dry-run');
    if (isDryRun) {
      console.log('--- DRY RUN MODE: No changes will be saved ---');
    } else {
      console.log('--- COMMIT MODE: Changes will be saved ---');
    }

    const holds = await RoomHold.find({});
    console.log(`Found ${holds.length} RoomHolds to migrate.`);

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const hold of holds) {
      try {
        const existingBooking = await Booking.findOne({ '_migratedFrom.originalId': hold._id });
        if (existingBooking) {
          skippedCount++;
          continue;
        }

        const user = await User.findById(hold.userId);
        if (!user) {
          console.warn(`User not found for RoomHold ${hold._id}, skipping...`);
          errorCount++;
          continue;
        }

        const status = mapStatus(hold.status);
        
        // Build the new booking object
        const bookingData = {
          userId: hold.userId,
          status,
          selections: {
            roomType: 'AXIS_PLUS_STUDIO', // Fallback, would need actual join with RoomType to map name
            roomTypeId: hold.roomTypeId,
            tenure: 11,
          },
          financials: {
            securityDeposit: (hold.depositAmount || 15000) * 100, // paise
            registrationFee: (hold.registrationFeePaid || 0) * 100,
            registrationGst: 0,
            totalBookingAmount: (hold.totalPaidAtDeposit || 15000) * 100,
            totalPaid: (hold.status !== 'pending_approval' ? (hold.totalPaidAtDeposit || 15000) * 100 : 0)
          },
          timers: {
            finalPaymentDeadline: hold.paymentDeadline,
          },
          _migratedFrom: {
            collection: 'RoomHolds',
            originalId: hold._id,
            migratedAt: new Date()
          },
          paymentPlan: {
            type: mapPaymentMode(hold.paymentMode) || mapPaymentMode(hold.finalPaymentMode)
          }
        };

        const booking = new Booking(bookingData);
        
        if (!isDryRun) {
          await booking.save();
          // Update User profile
          user.paymentProfile = user.paymentProfile || {};
          user.paymentProfile.currentBookingId = booking.bookingId;
          if (status === 'UNDER_VERIFICATION') user.paymentProfile.paymentStatus = 'BOOKING_PENDING';
          else if (status === 'FINAL_PAYMENT_PENDING') user.paymentProfile.paymentStatus = 'BOOKING_CONFIRMED';
          else if (status === 'CLOSED') user.paymentProfile.paymentStatus = 'FULLY_PAID';
          else user.paymentProfile.paymentStatus = 'NO_BOOKING';
          
          await user.save({ validateBeforeSave: false });
        }

        migratedCount++;
      } catch (err) {
        console.error(`Error migrating hold ${hold._id}:`, err.message);
        errorCount++;
      }
    }

    console.log('Migration Summary:');
    console.log(`Migrated: ${migratedCount}`);
    console.log(`Skipped (already migrated): ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

runMigration();
