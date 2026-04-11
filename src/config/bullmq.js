import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

/**
 * BullMQ requires each Queue / Worker to own a separate ioredis instance
 * (it cannot share the rate-limit singleton). This factory stamps one out
 * with the options BullMQ mandates.
 */
export function createBullMQConnection() {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
}
