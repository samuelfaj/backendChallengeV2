// src/app.ts
import app from "./config/app";
import { checkDatabaseConnection } from "./db/health.js";

app.get("/", async (req, res) => {
  res.send("Hello World");
});

async function startServer() {
  const dbHealth = await checkDatabaseConnection();
  
  if (dbHealth.connected) {
    console.log("✅ Database connection successful");
  } else {
    console.error("❌ Database connection failed:", dbHealth.error);
    process.exit(1);
  }

  app.listen(process.env.PORT || 3000, () => {
    console.log("Server is running on port 3000");
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});