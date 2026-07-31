const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function loadEnvFiles() {
  const rootDir = __dirname;
  const explicitEnvFile = String(process.env.ENV_FILE || "").trim();

  if (explicitEnvFile) {
    dotenv.config({
      path: path.resolve(rootDir, explicitEnvFile),
      override: true
    });
    return;
  }

  dotenv.config({
    path: path.resolve(rootDir, ".env")
  });

  const mode = String(process.env.NODE_ENV || "development").trim().toLowerCase();
  if (mode === "production") {
    return;
  }

  const modeFilePath = path.resolve(rootDir, ".env.local");

  if (fs.existsSync(modeFilePath)) {
    dotenv.config({
      path: modeFilePath,
      override: false
    });
  }
}

function readBooleanEnv(name, defaultValue = false) {
  const raw = String(process.env[name] ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

loadEnvFiles();

const { connectMongo } = require("./config/mongo");
const { createApp } = require("./app");

const PORT = Number(process.env.PORT || 5000);

async function startServer() {
  const isProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  const allowStartupWithoutDb = readBooleanEnv("ALLOW_STARTUP_WITHOUT_DB", !isProduction);
  const skipDbConnect = readBooleanEnv("SKIP_DB_CONNECT", false);
  const hasMongoConfig = Boolean(process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_FALLBACK_URI);

  let dbStatus = { status: "unknown" };

  if (skipDbConnect) {
    dbStatus = { status: "skipped" };
    console.log("Database connection skipped via SKIP_DB_CONNECT=true");
  } else if (!hasMongoConfig) {
    dbStatus = { status: "not_configured", message: "No MongoDB URI configured" };
    if (allowStartupWithoutDb) {
      console.warn("No MongoDB URI configured; starting backend without a database connection.");
    } else {
      throw new Error("MONGO_URI (or MONGODB_URI) is required");
    }
  } else {
    try {
      const mongoConnection = await connectMongo();
      if (mongoConnection?.source) {
        dbStatus = {
          status: "connected",
          source: mongoConnection.source
        };
        console.log(`Mongo connected using ${mongoConnection.source} source`);
      }
    } catch (error) {
      dbStatus = {
        status: "degraded",
        message: error.message
      };
      if (allowStartupWithoutDb) {
        console.warn(`MongoDB connection failed; starting backend in degraded mode: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  const app = createApp({ dbStatus });
  app.listen(PORT, () => {
    console.log(`CMR Smart Presentation backend running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error.message);
  process.exit(1);
});
