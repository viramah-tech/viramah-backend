const mongoose = require("mongoose");

const connectDB = async () => {
  const options = {
    dbName: process.env.DB_NAME || "viramah",
    tls: true,
    tlsAllowInvalidCertificates: true,
    serverSelectionTimeoutMS: 5000, 
  };

  try {
    await mongoose.connect(process.env.MONGODB_URI, options);
    console.log("MongoDB Atlas connected successfully");
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
