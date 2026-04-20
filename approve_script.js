
require("dotenv").config();
const connectDB = require("./src/config/db");
const User = require("./src/models/User");
const adminService = require("./src/services/adminService");
const mongoose = require("mongoose");

const run = async () => {
    try {
        await connectDB();
        
        const targetUserId = "RES000002";
        const user = await User.findOne({ "basicInfo.userId": targetUserId });
        if (!user) {
            console.error("User RES000002 not found");
            process.exit(1);
        }
        
        const pendingPayment = user.paymentDetails
            .filter(p => p.status === "pending" && p.paymentType === "booking")
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
            
        if (!pendingPayment) {
            console.error("No pending booking payment found for user RES000002");
            process.exit(1);
        }
        
        const adminUser = await User.findOne({ "auth.role": "admin" });
        if (!adminUser) {
            console.error("No admin user found");
            process.exit(1);
        }
        
        const adminUserId = adminUser.basicInfo.userId;
        const paymentId = pendingPayment.paymentId;
        
        console.log(`Approving payment ${paymentId} for user ${targetUserId} by admin ${adminUserId}`);
        
        const result = await adminService.approvePayment(targetUserId, paymentId, adminUserId);
        
        const updatedUser = await User.findOne({ "basicInfo.userId": targetUserId });
        console.log(`Approved Payment ID: ${paymentId}`);
        console.log(`Resulting Onboarding Step: ${updatedUser.onboarding.currentStep}`);
        
        process.exit(0);
    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
};

run();

