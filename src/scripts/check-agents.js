require("dotenv").config();
const connectDB = require("../config/db");
const SalesAgent = require("../models/SalesAgent");
const User = require("../models/User");

const run = async () => {
  await connectDB();
  console.log("Connected to database!");
  const agents = await SalesAgent.find();
  console.log("--- Sales Agents ---");
  console.log(JSON.stringify(agents, null, 2));

  const users = await User.find({ role: "sales_member" });
  console.log("--- Legacy Users in User collection (should be 0) ---");
  console.log(JSON.stringify(users, null, 2));
  
  process.exit(0);
};

run().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
