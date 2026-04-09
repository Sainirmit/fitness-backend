import Redis from "ioredis";

const REDIS_DISABLED =
  process.env.REDIS_DISABLED === "1" ||
  process.env.REDIS_DISABLED === "true";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

let client = null;
let healthy = false;

export function getRedisClient() {
  if (REDIS_DISABLED) return null;
  if (client) return client;

  client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 200, 5000);
    },
    lazyConnect: true,
  });

  client.on("connect", () => {
    healthy = true;
    console.log("[Redis] connected");
  });
  client.on("error", (err) => {
    healthy = false;
    console.error("[Redis] error:", err.message);
  });
  client.on("close", () => {
    healthy = false;
  });

  client.connect().catch(() => {});

  return client;
}

export function isRedisHealthy() {
  return healthy;
}

export async function disconnectRedis() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
    healthy = false;
  }
}
