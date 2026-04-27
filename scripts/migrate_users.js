require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function migrateUsers() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    // Find all users
    const users = await User.find({});
    console.log(`Found ${users.length} users to check for migration.`);

    let updatedCount = 0;

    for (const user of users) {
      let needsSave = false;

      // Check if documentVerificationStatus is missing
      if (!user.verification.documentVerificationStatus) {
        user.verification.documentVerificationStatus = user.verification.documentVerified ? 'approved' : 'pending';
        needsSave = true;
      }

      if (needsSave) {
        await user.save();
        updatedCount++;
      }
    }

    console.log(`Migration complete. Updated ${updatedCount} users.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateUsers();
