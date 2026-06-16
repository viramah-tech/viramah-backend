const mongoose = require("mongoose");

const uri = "mongodb://viramahtech_db_user:Yd2n5lS8LdrDfErg@ac-spfrt0f-shard-00-00.kupk7hd.mongodb.net:27017,ac-spfrt0f-shard-00-01.kupk7hd.mongodb.net:27017,ac-spfrt0f-shard-00-02.kupk7hd.mongodb.net:27017/viramah?ssl=true&authSource=admin";

async function run() {
  try {
    console.log("Connecting directly...");
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log("Connected directly successfully!");
    await mongoose.disconnect();
  } catch (err) {
    console.error("Direct connection failed:", err);
  }
}

run();
