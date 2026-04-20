const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

const connectDB = async () => {
  const certPath = path.join(__dirname, "../../global-bundle.pem");
  const options = {
    dbName: process.env.DB_NAME || "viramah",
  };
  if (process.env.NODE_ENV !== "production") {
    // In local development, avoid 'unable to get local issuer certificate' when connecting to DocumentDB/Atlas
    options.tlsAllowInvalidCertificates = true;
  }
  if (fs.existsSync(certPath) && process.env.NODE_ENV === "production") {
    options.tls = true;
    options.tlsCAFile = certPath;
  }
  await mongoose.connect(process.env.MONGODB_URI, options);
  console.log("MongoDB connected");
};

module.exports = connectDB;
