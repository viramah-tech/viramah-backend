const mongoose = require("mongoose");

const MONGODB_URI = "mongodb+srv://viramahtech_db_user:Yd2n5lS8LdrDfErg@cluster0.kupk7hd.mongodb.net/?appName=Cluster0";

async function main() {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("Connected successfully!");

    // Let's define the SalesAgent schema
    const agentSchema = new mongoose.Schema({
        name: String,
        email: String,
        phone: String,
        role: String,
        accountStatus: String,
    }, { collection: "salesagents" });

    const SalesAgent = mongoose.models.SalesAgent || mongoose.model("SalesAgent", agentSchema);

    const leadSchema = new mongoose.Schema({
        name: String,
        email: String,
        phone: String,
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "SalesAgent" },
        createdAt: Date,
    }, { collection: "leads" });

    const Lead = mongoose.models.Lead || mongoose.model("Lead", leadSchema);

    const activeAgents = await SalesAgent.find({ accountStatus: "active" });
    console.log(`Active Sales Agents (${activeAgents.length}):`);
    activeAgents.forEach(a => {
        console.log(`- ID: ${a._id}, Name: ${a.name}, Email: ${a.email}, Status: ${a.accountStatus}`);
    });

    const recentLeads = await Lead.find().sort({ createdAt: -1 }).limit(10);
    console.log("\nRecent Leads (last 10):");
    recentLeads.forEach(l => {
        console.log(`- Name: ${l.name}, Email: ${l.email}, Assigned To: ${l.assignedTo}, Created: ${l.createdAt}`);
    });

    await mongoose.disconnect();
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
