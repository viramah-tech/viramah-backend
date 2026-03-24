const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const connectDB = async () => {
  try {
    const options = {};
    const uri = process.env.MONGODB_URI || '';

    if (uri.includes('tls=true') || uri.includes('ssl=true')) {
      const caPath = path.resolve(__dirname, '../../global-bundle.pem');
      if (fs.existsSync(caPath)) {
        options.tls = true;
        options.tlsCAFile = caPath;
        options.tlsAllowInvalidHostnames = true;
        options.directConnection = true;
        options.authMechanism = 'SCRAM-SHA-1';
        options.authSource = 'admin';
      }
    }

    const conn = await mongoose.connect(uri, options);
    console.log(`MongoDB connected: ${conn.connection.host}`);

    // Connection event handlers
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected successfully');
    });

  } catch (err) {
    console.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
