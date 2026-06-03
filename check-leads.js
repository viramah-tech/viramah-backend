require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("./src/config/db");
const Lead = require("./src/models/Lead");

const checkLeads = async () => {
  try {
    await connectDB();
    const leads = await Lead.find({});
    console.log("--- DIAGNOSTIC LEADS REPORT ---");
    console.log("Total leads in DB:", leads.length);
    console.log(JSON.stringify(leads, null, 2));
    mongoose.disconnect();
  } catch (err) {
    console.error("Error in checkLeads script:", err);
  }
};

checkLeads();
