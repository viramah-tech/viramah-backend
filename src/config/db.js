const mongoose = require("mongoose");
const dns = require("dns");

/**
 * Manually resolve a mongodb+srv:// URI into a standard mongodb:// URI
 * using a custom DNS resolver pointed at Google DNS (8.8.8.8).
 * This bypasses local DNS servers that fail SRV queries.
 */
const resolveSrvManually = async (srvUri) => {
  // Parse the SRV URI: mongodb+srv://user:pass@cluster0.xxx.mongodb.net/?options
  const match = srvUri.match(/^mongodb\+srv:\/\/([^@]+)@([^/?]+)(.*)?$/);
  if (!match) return null;

  const credentials = match[1]; // user:pass
  const srvHostname = match[2]; // cluster0.xxx.mongodb.net
  const queryString = match[3] || ""; // /?appName=Cluster0

  const resolver = new dns.promises.Resolver();
  resolver.setServers(["8.8.8.8", "8.8.4.4"]);

  console.log("[DB] Manually resolving SRV records via Google DNS for:", srvHostname);

  // Resolve SRV records
  const srvRecords = await resolver.resolveSrv(`_mongodb._tcp.${srvHostname}`);
  if (!srvRecords || srvRecords.length === 0) {
    throw new Error("No SRV records found via manual resolution");
  }

  // Resolve TXT records for authSource and replicaSet
  let txtParams = "";
  try {
    const txtRecords = await resolver.resolveTxt(srvHostname);
    if (txtRecords && txtRecords.length > 0) {
      txtParams = txtRecords.map((r) => r.join("")).join("&");
    }
  } catch (_) {
    // TXT records are optional
  }

  // Build the host list: host1:port,host2:port,host3:port
  const hostList = srvRecords.map((r) => `${r.name}:${r.port}`).join(",");

  // Build the final standard URI
  // Merge TXT params with any existing query params
  let finalQuery = "";
  const existingParams = queryString.startsWith("/?") ? queryString.slice(2) : queryString.startsWith("?") ? queryString.slice(1) : "";
  const allParams = [txtParams, existingParams, "ssl=true"].filter(Boolean).join("&");
  if (allParams) finalQuery = `/?${allParams}`;

  const resolvedUri = `mongodb://${credentials}@${hostList}${finalQuery}`;
  console.log(`[DB] Resolved ${srvRecords.length} hosts via manual SRV lookup`);
  return resolvedUri;
};

// Store the resolved/working URI so other modules (session.js) can use it
let resolvedMongoUri = null;
const getResolvedMongoUri = () => resolvedMongoUri;

const connectDB = async () => {
  const options = {
    dbName: process.env.DB_NAME || "viramah",
    tls: true,
    tlsAllowInvalidCertificates: true,
    serverSelectionTimeoutMS: 5000,
  };

  const primaryUri = process.env.MONGODB_URI;
  const localFallback = `mongodb://127.0.0.1:27017/${options.dbName}`;

  // Optional: allow forcing DNS servers for SRV lookups from Node.js
  // Set MONGODB_FORCE_DNS=true to enable default Google DNS, or
  // set MONGODB_DNS_SERVERS to a comma-separated list (e.g. 8.8.8.8,8.8.4.4)
  try {
    if (process.env.MONGODB_DNS_SERVERS) {
      const list = process.env.MONGODB_DNS_SERVERS.split(",").map((s) => s.trim());
      dns.setServers(list);
      console.log("DNS servers for Node resolver set to:", list);
    } else if (process.env.MONGODB_FORCE_DNS === "true") {
      dns.setServers(["8.8.8.8", "8.8.4.4"]);
      console.log("MONGODB_FORCE_DNS enabled — using Google DNS for SRV resolution");
    }
  } catch (dnsErr) {
    console.warn("Could not set DNS servers:", dnsErr.message);
  }

  console.log("[DB] MONGODB_URI set:", !!primaryUri, " — MONGODB_URI_NO_SRV set:", !!process.env.MONGODB_URI_NO_SRV);

  try {
    if (!primaryUri) {
      console.error("[DB] No MONGODB_URI provided. This deployment requires a remote MongoDB connection via MONGODB_URI.");
      process.exit(1);
    }

    // Try the provided primary URI first
    // If it's an SRV URI, test DNS resolution first to avoid mongoose's internal SRV crash
    if (primaryUri.startsWith("mongodb+srv://")) {
      const srvHost = primaryUri.match(/@([^/?]+)/)?.[1];
      let useFallbackUri = false;

      // Quick test: can Node's default DNS resolve the SRV record?
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("SRV lookup timeout")), 4000);
          dns.resolveSrv(`_mongodb._tcp.${srvHost}`, (err, addresses) => {
            clearTimeout(timeout);
            if (err) reject(err);
            else resolve(addresses);
          });
        });
      } catch (dnsTestErr) {
        console.error("[DB] Default DNS cannot resolve SRV for", srvHost, ":", dnsTestErr.message);
        useFallbackUri = true;
      }

      if (useFallbackUri) {
        // Resolve manually via Google DNS and build a standard mongodb:// URI
        try {
          console.log("[DB] Attempting manual SRV resolution via Google DNS...");
          const resolvedUri = await resolveSrvManually(primaryUri);
          if (resolvedUri) {
            resolvedMongoUri = resolvedUri;
            await mongoose.connect(resolvedUri, options);
            console.log("MongoDB connected successfully (manual SRV resolution via Google DNS)");
            return;
          }
        } catch (manualErr) {
          console.error("[DB] Manual SRV resolution fallback failed:", manualErr.message);
        }
      } else {
        // Default DNS works, use the SRV URI directly
        try {
          console.log("[DB] Attempting connection using MONGODB_URI (SRV)...");
          resolvedMongoUri = primaryUri;
          await mongoose.connect(primaryUri, options);
          console.log("MongoDB connected successfully (Atlas SRV)");
          return;
        } catch (primaryErr) {
          console.error("[DB] Connection using MONGODB_URI failed:", primaryErr.message);
        }
      }
    } else {
      // Non-SRV URI, connect directly
      try {
        console.log("[DB] Attempting connection using MONGODB_URI...");
        resolvedMongoUri = primaryUri;
        await mongoose.connect(primaryUri, options);
        console.log("MongoDB connected successfully (direct URI)");
        return;
      } catch (primaryErr) {
        console.error("[DB] Connection using MONGODB_URI failed:", primaryErr.message);
      }
    }
    // If none of the above connected, try remaining fallbacks

    // If user supplied a non-SRV fallback for Atlas, attempt it before giving up
    const noSrvUri = process.env.MONGODB_URI_NO_SRV;
    if (noSrvUri) {
      try {
        console.log("[DB] Attempting non-SRV MONGODB_URI_NO_SRV fallback...");
        await mongoose.connect(noSrvUri, { ...options, tls: false });
        console.log("MongoDB connected successfully using MONGODB_URI_NO_SRV (non-SRV hosts)");
        return;
      } catch (noSrvErr) {
        console.error("[DB] Non-SRV fallback connection failed:", noSrvErr.message);
      }
    }
    // If we're running in development and a developer explicitly allows local fallback,
    // try the local MongoDB before exiting. This keeps production failing fast.
    const allowLocalFallback = process.env.LOCAL_MONGO_FALLBACK === "true" && process.env.NODE_ENV !== "production";
    if (allowLocalFallback) {
      try {
        console.log("[DB] Attempting local MongoDB fallback at 127.0.0.1:27017 (development only)...");
        await mongoose.connect(localFallback, { ...options, tls: false });
        console.log("MongoDB connected successfully (local fallback)");
        return;
      } catch (localErr) {
        console.error("[DB] Local fallback connection also failed:", localErr.message);
      }
    }

    console.error("[DB] Remote connection attempts failed. This deployment is configured to use an online MongoDB only.\nPlease verify MONGODB_URI, Atlas network access (IP whitelist), and SRV/DNS resolution. For environments blocking SRV lookups, set MONGODB_URI_NO_SRV with the comma-separated host list provided by Atlas. To allow a local fallback during development, set LOCAL_MONGO_FALLBACK=true in your .env.");
    process.exit(1);
  } catch (error) {
    console.error("[DB] Fatal error while attempting DB connection:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
module.exports.getResolvedMongoUri = getResolvedMongoUri;
module.exports.resolveSrvManually = resolveSrvManually;
