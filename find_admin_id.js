
require("dotenv").config();
const connectDB = require("./src/config/db");
const User = require("./src/models/User");

const run = async () => {
    try {
        await connectDB();
        const admin = await User.findOne({ "role": "admin" });
        console.log("Admin:", JSON.stringify(admin, null, 2));
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
};
run();

