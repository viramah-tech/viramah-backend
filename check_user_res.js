
require("dotenv").config();
const connectDB = require("./src/config/db");
const User = require("./src/models/User");

const run = async () => {
    try {
        await connectDB();
        const user = await User.findOne({ "basicInfo.userId": "RES000002" });
        console.log("User RES000002:", JSON.stringify(user, null, 2));
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
};
run();

