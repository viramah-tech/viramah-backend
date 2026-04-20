
require("dotenv").config();
const connectDB = require("./src/config/db");
const User = require("./src/models/User");

const run = async () => {
    try {
        await connectDB();
        const users = await User.find({}, "basicInfo.userId auth.role").limit(10);
        console.log("Users:", JSON.stringify(users, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};
run();

