
require("dotenv").config();
const connectDB = require("./src/config/db");
const User = require("./src/models/User");

const run = async () => {
    try {
        await connectDB();
        const admins = await User.find({ "auth.role": "admin" });
        if (admins.length > 0) {
            console.log("Admins (auth.role):", JSON.stringify(admins, null, 2));
        } else {
            const allUsers = await User.find({}, "basicInfo.userId auth.role role");
            console.log("All users (userId, auth.role, role):", JSON.stringify(allUsers, null, 2));
        }
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
};
run();

