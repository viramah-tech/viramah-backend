const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, { tls: true, tlsAllowInvalidCertificates: true })
  .then(async () => {
    const db = mongoose.connection.db;
    const users = await db.collection('users').find({}).toArray();
    console.log(JSON.stringify(users.map(u => ({
      email: u.basicInfo?.email,
      paymentSummary: u.paymentSummary,
      detailsLen: u.paymentDetails?.length
    })).filter(u => u.detailsLen > 0), null, 2));
    process.exit(0);
  })
  .catch(e => {
    console.error(e.message);
    process.exit(1);
  });
