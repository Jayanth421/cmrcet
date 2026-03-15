const fs = require("fs");
const path = require("path");
const dns = require("dns");
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

loadEnvFiles();

function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLocalDnsServer(server) {
  const value = String(server || "").trim();
  return value === "127.0.0.1" || value === "::1";
}

async function ensureNodeDns() {
  const explicitServers = parseCommaList(process.env.DNS_SERVERS);
  if (explicitServers.length > 0) {
    dns.setServers(explicitServers);
    console.log(`Node DNS servers set via DNS_SERVERS (${explicitServers.join(", ")})`);
    return;
  }

  const currentServers = dns.getServers();
  const localOnly = currentServers.length > 0 && currentServers.every(isLocalDnsServer);
  if (!localOnly) return;

  try {
    await dns.promises.resolve4("example.com");
    return;
  } catch (_error) {
    // Fall through and apply fallback servers.
  }

  const fallbackServers = parseCommaList(process.env.DNS_FALLBACK_SERVERS);
  const nextServers = fallbackServers.length > 0 ? fallbackServers : ["8.8.8.8", "1.1.1.1"];
  dns.setServers(nextServers);
  console.warn(
    `Node DNS lookup failed using local resolver (${currentServers.join(
      ", "
    )}); switched to ${nextServers.join(", ")}. Set DNS_SERVERS to override.`
  );
}

const app = require("./app");
const { connectMongo } = require("./config/mongo");

const PORT = Number(process.env.PORT || 5000);

async function startServer() {
  try {
    await ensureNodeDns();
    const mongoConnection = await connectMongo();
    if (mongoConnection?.source) {
      console.log(`Mongo connected using ${mongoConnection.source} source`);
    }
    app.listen(PORT, () => {
      console.log(`CMR Smart Presentation backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
