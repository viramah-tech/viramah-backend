const mongoose = require('mongoose');
require('dotenv').config();
const paymentService = require('./src/services/paymentService');

mongoose.connect(process.env.MONGODB_URI, { tls: true, tlsAllowInvalidCertificates: true })
  .then(async () => {
    const User = require('./src/models/User');
    const user = await User.findOne({ "basicInfo.email": "sanskarofficial512@gmail.com" });
    if (!user) {
      console.log("User not found");
      process.exit(1);
    }
    const status = await paymentService.getPaymentStatus(user);
    console.log(JSON.stringify(status, null, 2));
    process.exit(0);
  })
  .catch(e => {
    console.error(e.message);
    process.exit(1);
  });
