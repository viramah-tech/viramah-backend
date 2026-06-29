process.env.MONGODB_URI = 'mongodb+srv://viramahtech_db_user:Yd2n5lS8LdrDfErg@cluster0.kupk7hd.mongodb.net/?appName=Cluster0';
const connectDB = require('./src/config/db');
const User = require('./src/models/User');

(async () => {
  try {
    await connectDB();
    const query = {
      $or: [
        { 'basicInfo.phone': '9634010474' },
        { 'basicInfo.fullName': { $regex: 'Tejas', $options: 'i' } },
      ],
    };

    const user = await User.findOne(query).lean();

    if (!user) {
      console.log('NO_USER_FOUND');
      process.exit(0);
    }

    console.log(JSON.stringify({
      id: user._id,
      basicInfo: user.basicInfo,
      accountStatus: user.accountStatus,
      onboarding: user.onboarding,
      verification: user.verification,
      roomDetails: user.roomDetails,
      paymentSummary: user.paymentSummary,
      compliance: user.compliance,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
