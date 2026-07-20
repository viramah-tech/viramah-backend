require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const { sendWhatsappGroupInviteEmail } = require("../services/emailService");

const run = async () => {
  const args = process.argv.slice(2);
  const target = args[0];

  if (!target) {
    console.log(`
===================================================================
Viramah WhatsApp Invite Sender CLI
===================================================================
Usage:
  node src/scripts/send-whatsapp-invite-test.js <email> [fullName]
  node src/scripts/send-whatsapp-invite-test.js --all

Examples:
  node src/scripts/send-whatsapp-invite-test.js test@example.com "John Doe"
  node src/scripts/send-whatsapp-invite-test.js --all
===================================================================
    `);
    process.exit(0);
  }

  try {
    console.log("[CLI] Connecting to database...");
    await connectDB();
    console.log("[CLI] Database connected.");

    if (target === "--all") {
      console.log("[CLI] Running in BULK mode. Fetching all users...");
      const users = await User.find({ "basicInfo.email": { $exists: true } });
      
      if (users.length === 0) {
        console.log("[CLI] No users found with a valid email address.");
        await mongoose.disconnect();
        process.exit(0);
      }

      console.log(`[CLI] Found ${users.length} users. Starting email broadcast...`);
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const email = user.basicInfo.email;
        const name = user.basicInfo.fullName || "Resident";
        
        try {
          console.log(`[CLI] [${i + 1}/${users.length}] Sending invite to ${name} <${email}>...`);
          await sendWhatsappGroupInviteEmail(user);
          successCount++;
        } catch (err) {
          console.error(`[CLI] Failed to send to ${email}:`, err.message);
          failCount++;
        }
      }

      console.log(`\n[CLI] Broadcast completed.`);
      console.log(`[CLI] Successfully sent: ${successCount}`);
      console.log(`[CLI] Failed: ${failCount}`);
    } else {
      const email = target;
      const fullName = args[1] || "Test Resident";
      console.log(`[CLI] Running in TEST mode.`);
      console.log(`[CLI] Target Email: ${email}`);
      console.log(`[CLI] Target Name: ${fullName}`);

      const dummyUser = {
        basicInfo: {
          email,
          fullName,
          userId: "USR-TEST-999"
        }
      };

      console.log(`[CLI] Sending WhatsApp invitation email...`);
      await sendWhatsappGroupInviteEmail(dummyUser);
      console.log(`[CLI] Invitation sent successfully to ${email}!`);
    }

    await mongoose.disconnect();
    console.log("[CLI] Database disconnected.");
    process.exit(0);
  } catch (err) {
    console.error("[CLI] Execution failed:", err);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
  }
};

run();
