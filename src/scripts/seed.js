const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load env vars
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const User = require('../models/User');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');

const seedDatabase = async () => {
  try {
    // Connect to MongoDB/DocumentDB
    const connectOptions = {};
    const uri = process.env.MONGODB_URI || '';
    if (uri.includes('tls=true')) {
      const fs = require('fs');
      const caPath = path.join(__dirname, '..', '..', 'global-bundle.pem');
      if (fs.existsSync(caPath)) {
        connectOptions.tls = true;
        connectOptions.tlsCAFile = caPath;
        connectOptions.tlsAllowInvalidHostnames = true;
        connectOptions.directConnection = true;
        connectOptions.authMechanism = 'SCRAM-SHA-1';
        connectOptions.authSource = 'admin';
      }
    }
    await mongoose.connect(uri, connectOptions);
    console.log('MongoDB connected for seeding');

    // Clear existing data
    await User.deleteMany({});
    await Payment.deleteMany({});
    await Transaction.deleteMany({});
    console.log('Cleared existing data');

    // Create admin user
    const admin = await User.create({
      userId: 'admin001',
      name: 'Super Admin',
      email: 'admin@viramah.com',
      phone: '9000000001',
      password: 'Viramah@2026',
      role: 'admin',
      status: 'active',
    });
    console.log('Created admin user: admin001');

    // Create accountant user
    const accountant = await User.create({
      userId: 'acc001',
      name: 'Main Accountant',
      email: 'accountant@viramah.com',
      phone: '9000000002',
      password: 'Account@123',
      role: 'accountant',
      status: 'active',
    });
    console.log('Created accountant user: acc001');

    // Create 10 sample users
    const roomTypes = ['VIRAMAH Nexus', 'VIRAMAH Axis', 'VIRAMAH Collective', 'VIRAMAH Axis+'];
    const roomNumbers = ['A-101', 'A-102', 'B-201', 'B-202', 'C-301', 'C-302', 'D-401', 'D-402', 'A-103', 'B-203'];
    const onboardingStatuses = [
      'completed', 'completed', 'completed', 'completed', 'completed', 'completed',
      'in-progress', 'in-progress', 'pending', 'rejected',
    ];
    const genders = ['male', 'female'];
    const sampleAddresses = [
      '12, MG Road, Bengaluru, Karnataka 560001',
      '45, Park Street, Kolkata, West Bengal 700016',
      '78, Connaught Place, New Delhi 110001',
      '23, Marine Drive, Mumbai, Maharashtra 400002',
      '56, Anna Salai, Chennai, Tamil Nadu 600002',
      '34, Banjara Hills, Hyderabad, Telangana 500034',
      '89, Civil Lines, Jaipur, Rajasthan 302006',
      '67, Hazratganj, Lucknow, Uttar Pradesh 226001',
      '11, FC Road, Pune, Maharashtra 411004',
      '90, Sector 17, Chandigarh 160017',
    ];
    const emergencyNames = [
      'Ramesh Kumar', 'Sunita Devi', 'Anil Sharma', 'Priya Singh',
      'Vijay Patel', 'Meena Gupta', 'Suresh Reddy', 'Kavita Nair',
      'Rajesh Verma', 'Anjali Das',
    ];
    const emergencyRelations = ['Father', 'Mother', 'Father', 'Mother', 'Father', 'Mother', 'Father', 'Mother', 'Father', 'Mother'];

    const sampleUsers = [];
    for (let i = 1; i <= 10; i++) {
      const user = await User.create({
        userId: `user${String(i).padStart(3, '0')}`,
        name: `User ${i}`,
        email: `user${i}@example.com`,
        phone: `90000${String(10000 + i)}`,
        password: `User@${String(i).padStart(3, '0')}`,
        role: 'user',
        status: i <= 8 ? 'active' : i === 9 ? 'inactive' : 'suspended',
        roomNumber: roomNumbers[i - 1],
        roomType: roomTypes[(i - 1) % roomTypes.length],
        onboardingStatus: onboardingStatuses[i - 1],
        gender: genders[(i - 1) % genders.length],
        dateOfBirth: new Date(2000 + ((i - 1) % 6), (i * 2) % 12, (i * 3) % 28 + 1),
        address: sampleAddresses[i - 1],
        emergencyContact: {
          name: emergencyNames[i - 1],
          phone: `98000${String(10000 + i)}`,
          relation: emergencyRelations[i - 1],
        },
      });
      sampleUsers.push(user);
    }
    console.log('Created 10 sample users');

    // Create 15 sample payments
    const paymentStatuses = ['pending', 'approved', 'rejected'];
    const paymentMethods = ['UPI', 'Bank Transfer', 'Cash', 'Cheque', 'Online'];
    const payments = [];

    for (let i = 1; i <= 15; i++) {
      const userIndex = (i - 1) % sampleUsers.length;
      const statusIndex = (i - 1) % paymentStatuses.length;
      const methodIndex = (i - 1) % paymentMethods.length;

      const paymentData = {
        paymentId: `PAY${String(i).padStart(6, '0')}`,
        userId: sampleUsers[userIndex]._id,
        amount: Math.floor(Math.random() * 50000) + 1000,
        currency: 'INR',
        status: paymentStatuses[statusIndex],
        paymentMethod: paymentMethods[methodIndex],
        description: `Payment ${i} - ${paymentMethods[methodIndex]}`,
        transactionId: `TXN20260323${String(i).padStart(3, '0')}`,
        receiptUrl: i <= 10 ? `/receipts/receipt-${i}.jpg` : '',
      };

      // Add approvedBy for approved payments
      if (paymentData.status === 'approved') {
        paymentData.approvedBy = admin._id;
      }

      // Add remarks for rejected payments
      if (paymentData.status === 'rejected') {
        paymentData.remarks = 'Payment details mismatch';
      }

      const payment = await Payment.create(paymentData);
      payments.push(payment);
    }
    console.log('Created 15 sample payments');

    // Create 20 sample transactions
    const transactionTypes = ['credit', 'debit'];
    const categories = ['Hostel Fee', 'Mess Fee', 'Library Fee', 'Sports Fee', 'Miscellaneous', 'Refund'];

    for (let i = 1; i <= 20; i++) {
      const userIndex = (i - 1) % sampleUsers.length;
      const typeIndex = (i - 1) % transactionTypes.length;
      const categoryIndex = (i - 1) % categories.length;
      const amount = Math.floor(Math.random() * 20000) + 500;
      const balanceBefore = Math.floor(Math.random() * 100000);
      const type = transactionTypes[typeIndex];
      const balanceAfter = type === 'credit' ? balanceBefore + amount : balanceBefore - amount;

      await Transaction.create({
        transactionId: `TXN${String(i).padStart(6, '0')}`,
        paymentId: payments[(i - 1) % payments.length]._id,
        userId: sampleUsers[userIndex]._id,
        type,
        amount,
        category: categories[categoryIndex],
        description: `${categories[categoryIndex]} - ${type === 'credit' ? 'Received' : 'Paid'}`,
        status: i <= 17 ? 'completed' : i === 18 ? 'pending' : 'failed',
        balanceBefore,
        balanceAfter,
      });
    }
    console.log('Created 20 sample transactions');

    console.log('\nSeed completed successfully!');
    console.log('\nLogin credentials:');
    console.log('  Admin   -> userId: admin001, password: Viramah@2026, role: admin');
    console.log('  Account -> userId: acc001,   password: Account@123, role: accountant');

    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err.message);
    process.exit(1);
  }
};

seedDatabase();
