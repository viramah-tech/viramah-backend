require("dotenv").config();
const connectDB = require("./src/config/db");

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  
  // Run sales agent collection migration
  const { runSalesAgentMigration } = require("./src/utils/migration");
  await runSalesAgentMigration();

  const app = require("./src/app");
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
