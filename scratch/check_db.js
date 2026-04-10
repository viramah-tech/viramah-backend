const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const Booking = require('./src/models/Booking');
const User = require('./src/models/User');

async function debug() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  // Find users with paymentStatus UNDER_VERIFICATION or similar
  const users = await User.find({ 'paymentProfile.paymentStatus': { $ne: 'NO_BOOKING' } }).limit(5);
  console.log('Users with active profiles:', users.map(u => ({ id: u._id, name: u.name, bookingId: u.paymentProfile?.currentBookingId })));

  // Find ALL bookings for a user if we had their ID
  // Let's just find the most recent bookings
  const bookings = await Booking.find().sort({ createdAt: -1 }).limit(5);
  console.log('Recent bookings:', bookings.map(b => ({ id: b._id, userId: b.userId, status: b.status })));

  process.exit(0);
}

debug().catch(err => {
  console.error(err);
  process.exit(1);
});
