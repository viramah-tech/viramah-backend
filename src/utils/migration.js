const User = require("../models/User");
const SalesAgent = require("../models/SalesAgent");

const runSalesAgentMigration = async () => {
  try {
    console.log("[MIGRATION] Checking for sales members in User collection...");
    const salesMembers = await User.find({ role: "sales_member" });
    
    if (salesMembers.length === 0) {
      console.log("[MIGRATION] No sales members found in User collection. Migration not required.");
      return;
    }
    
    console.log(`[MIGRATION] Found ${salesMembers.length} sales members in User collection. Migrating...`);
    
    for (const member of salesMembers) {
      const existing = await SalesAgent.findOne({
        $or: [
          { "basicInfo.email": member.basicInfo.email },
          { "basicInfo.userId": member.basicInfo.userId }
        ]
      });
      
      if (!existing) {
        // Create in SalesAgent using the EXACT same _id and data
        await SalesAgent.create({
          _id: member._id,
          basicInfo: {
            userId: member.basicInfo.userId,
            fullName: member.basicInfo.fullName,
            email: member.basicInfo.email,
            phone: member.basicInfo.phone
          },
          verification: {
            emailVerified: true,
            phoneVerified: true,
            documentVerified: true,
            otp: member.verification?.otp,
            otpExpiresAt: member.verification?.otpExpiresAt,
            otpAttempts: member.verification?.otpAttempts || 0,
            otpVerified: true
          },
          auth: {
            passwordHash: member.auth.passwordHash,
            lastLogin: member.auth.lastLogin,
            loginAttempts: member.auth.loginAttempts || 0,
            isBlocked: member.auth.isBlocked || false
          },
          role: "sales_member",
          accountStatus: member.accountStatus || "active",
          createdAt: member.createdAt,
          updatedAt: member.updatedAt
        });
        console.log(`[MIGRATION] Migrated sales agent: ${member.basicInfo.email}`);
      } else {
        console.log(`[MIGRATION] Sales agent already exists in new collection: ${member.basicInfo.email}`);
      }
      
      // Delete from User collection to isolate data
      await User.deleteOne({ _id: member._id });
      console.log(`[MIGRATION] Deleted sales agent from User collection: ${member.basicInfo.email}`);
    }
    
    console.log("[MIGRATION] Sales agent data migration completed successfully.");
  } catch (error) {
    console.error("[MIGRATION] Error running SalesAgent migration:", error);
  }
};

module.exports = { runSalesAgentMigration };
