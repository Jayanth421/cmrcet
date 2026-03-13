const mongoose = require("mongoose");

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function isTruthy(value, defaultValue = false) {
  if (!value) return defaultValue;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function maskMongoUri(uri) {
  if (!uri) return "";
  const value = String(uri);
  const atIndex = value.indexOf("@");
  if (atIndex === -1) return value;
  const protocolIndex = value.indexOf("://");
  if (protocolIndex === -1 || protocolIndex + 3 >= atIndex) return value;
  return `${value.slice(0, protocolIndex + 3)}***:***${value.slice(atIndex)}`;
}

function getMongoCandidates() {
  const primaryUri = readEnv("MONGO_URI") || readEnv("MONGODB_URI");
  const fallbackUri = readEnv("MONGO_FALLBACK_URI");
  const localUri = readEnv("MONGO_LOCAL_URI") || "mongodb://127.0.0.1:27017/cmr_smart_portal";
  const localFallbackEnabled = isTruthy(
    readEnv("MONGO_LOCAL_FALLBACK"),
    String(process.env.NODE_ENV || "development").trim().toLowerCase() !== "production"
  );

  const candidates = [];
  if (primaryUri) candidates.push({ label: "primary", uri: primaryUri });
  if (fallbackUri) candidates.push({ label: "fallback", uri: fallbackUri });
  if (localFallbackEnabled) candidates.push({ label: "local", uri: localUri });

  const seen = new Set();
  return candidates.filter((item) => {
    if (seen.has(item.uri)) return false;
    seen.add(item.uri);
    return true;
  });
}

function isExpectedRollNumberIndex(index) {
  if (!index || !index.unique) return false;
  const condition = index.partialFilterExpression?.rollNumber || null;
  return condition?.$exists === true && String(condition?.$type || "").toLowerCase() === "string";
}

async function ensureUserCollectionIndexes() {
  const usersCollection = mongoose.connection.collection("users");
  const indexes = await usersCollection.indexes();
  const rollNumberIndex = indexes.find((item) => item.name === "rollNumber_1");

  if (isExpectedRollNumberIndex(rollNumberIndex)) {
    return;
  }

  // Legacy data may store rollNumber as null; remove it so uniqueness applies only to real IDs.
  await usersCollection.updateMany({ rollNumber: null }, { $unset: { rollNumber: 1 } });

  if (rollNumberIndex) {
    await usersCollection.dropIndex("rollNumber_1");
  }

  await usersCollection.createIndex(
    { rollNumber: 1 },
    {
      name: "rollNumber_1",
      unique: true,
      partialFilterExpression: {
        rollNumber: { $exists: true, $type: "string" }
      }
    }
  );
}

async function connectMongo() {
  const mongoCandidates = getMongoCandidates();
  const timeoutMs = Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000);

  if (mongoCandidates.length === 0) {
    throw new Error("MONGO_URI is required (or enable MONGO_LOCAL_FALLBACK for local MongoDB)");
  }

  const failures = [];

  for (const candidate of mongoCandidates) {
    try {
      await mongoose.connect(candidate.uri, {
        serverSelectionTimeoutMS: timeoutMs
      });
      await ensureUserCollectionIndexes();
      return {
        source: candidate.label,
        uri: candidate.uri
      };
    } catch (error) {
      failures.push(`${candidate.label} [${maskMongoUri(candidate.uri)}] -> ${error.message}`);
      try {
        if (mongoose.connection.readyState !== 0) {
          await mongoose.disconnect();
        }
      } catch (_disconnectError) {
        // Ignore disconnect errors while retrying next candidate.
      }
    }
  }

  const failureReason = failures.join(" | ");
  throw new Error(
    `${failureReason}. If using Atlas, whitelist your current IP; otherwise use local MongoDB via MONGO_LOCAL_FALLBACK=true and MONGO_LOCAL_URI.`
  );
}

module.exports = {
  connectMongo
};
