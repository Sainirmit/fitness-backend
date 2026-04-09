import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient } from "../config/redis.js";

function env(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function redisStore(prefix) {
  try {
    const client = getRedisClient();
    if (!client) return undefined;
    return new RedisStore({
      sendCommand: (...args) => client.call(...args),
      prefix: `rl:${prefix}:`,
    });
  } catch {
    return undefined;
  }
}

function userAwareKey(req) {
  return req.user?._id?.toString() || ipKeyGenerator(req);
}

function rateLimitErrorResponse(_req, _res) {
  return {
    code: "RATE_LIMITED",
    message: "Too many requests. Please try again later.",
    retryable: true,
  };
}

/**
 * Global baseline limiter for all /api/* traffic.
 * Generous window to absorb scanners without affecting normal use.
 */
export const globalApiLimiter = rateLimit({
  windowMs: env("RATE_LIMIT_GLOBAL_WINDOW_MS", 60_000),
  limit: env("RATE_LIMIT_GLOBAL_MAX", 100),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: redisStore("global"),
  keyGenerator: ipKeyGenerator,
  message: rateLimitErrorResponse,
  skip: (req) =>
    req.path === "/health" || req.path === "/" || !req.path.startsWith("/api"),
});

/**
 * Strict limiter for auth endpoints (login / token exchange).
 * IP-based to block credential-stuffing before auth runs.
 */
export const authLimiter = rateLimit({
  windowMs: env("RATE_LIMIT_AUTH_WINDOW_MS", 15 * 60_000),
  limit: env("RATE_LIMIT_AUTH_MAX", 20),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: redisStore("auth"),
  keyGenerator: ipKeyGenerator,
  message: rateLimitErrorResponse,
});

/**
 * AI / high-cost endpoint limiter (workout generation).
 * User-aware keying; very tight limits.
 */
export const aiGenerationLimiter = rateLimit({
  windowMs: env("RATE_LIMIT_AI_GEN_WINDOW_MS", 60 * 60_000),
  limit: env("RATE_LIMIT_AI_GEN_MAX", 5),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: redisStore("ai-gen"),
  keyGenerator: userAwareKey,
  message: rateLimitErrorResponse,
});

/**
 * Body-photo upload + refinement trigger limiter.
 * User-aware; prevents spam photo uploads that trigger OpenAI vision calls.
 */
export const photoUploadLimiter = rateLimit({
  windowMs: env("RATE_LIMIT_PHOTO_WINDOW_MS", 60 * 60_000),
  limit: env("RATE_LIMIT_PHOTO_MAX", 6),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: redisStore("photo"),
  keyGenerator: userAwareKey,
  message: rateLimitErrorResponse,
});

/**
 * Polling endpoint limiter (generation-status, refinement-status).
 * More generous since polling is expected, but still bounded.
 */
export const pollingLimiter = rateLimit({
  windowMs: env("RATE_LIMIT_POLL_WINDOW_MS", 60_000),
  limit: env("RATE_LIMIT_POLL_MAX", 60),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: redisStore("poll"),
  keyGenerator: userAwareKey,
  message: rateLimitErrorResponse,
});
