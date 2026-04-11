import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "./config/database.js";
import { disconnectRedis } from "./config/redis.js";
import { globalApiLimiter } from "./middleware/rateLimit.js";
import { generateRequestId, formatErrorResponse } from "./utils/apiError.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import bodyDetailsRoutes from "./routes/bodyDetailsRoutes.js";
import bodyPhotosRoutes from "./routes/bodyPhotosRoutes.js";
import workoutPlanRoutes from "./routes/workoutPlanRoutes.js";
import workoutSessionRoutes from "./routes/workoutSessionRoutes.js";
import homeRoutes from "./routes/homeRoutes.js";
import {
  markMissedPastDueForAllUsers,
  markMissedCalendarDaysForAllUsers,
} from "./services/workoutOccurrenceService.js";
import { closeQueues } from "./queues/workoutGenQueue.js";
import { startWorkoutGenWorker, closeWorkoutGenWorker } from "./workers/workoutGenWorker.js";
import { startRefinementWorker, closeRefinementWorker } from "./workers/refinementWorker.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Dynamic JSON APIs: default weak ETags make identical poll bodies (e.g.
// { status: "generating" }) return 304; clients often keep cached state.
app.set("etag", false);

// Trust first proxy (load balancer / reverse proxy) for correct req.ip
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
}

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Attach a unique request ID for tracing
app.use((req, _res, next) => {
  req.requestId = generateRequestId();
  next();
});

// Global API rate limiter (applied before route mounts)
app.use(globalApiLimiter);

const shouldLogApiPayloads =
  process.env.NODE_ENV !== "production" || process.env.API_REQUEST_LOG === "1";

function redactForLog(value, depth = 0) {
  if (depth > 6) return "[MaxDepth]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactForLog(v, depth + 1));
  if (typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/password|secret|token|authorization|refreshToken|accessToken/i.test(k)) {
      out[k] = typeof v === "string" && v.length ? "[REDACTED]" : v;
    } else {
      out[k] = redactForLog(v, depth + 1);
    }
  }
  return out;
}

app.use((req, res, next) => {
  if (!req.originalUrl?.startsWith("/api") || !shouldLogApiPayloads) {
    return next();
  }

  const startedAt = process.hrtime.bigint();

  const queryKeys = Object.keys(req.query ?? {});
  const bodyKeys = Object.keys(req.body ?? {});

  console.log("[API REQUEST]", {
    method: req.method,
    url: req.originalUrl,
    ...(queryKeys.length ? { query: req.query } : {}),
    ...(bodyKeys.length ? { body: redactForLog(req.body) } : {}),
  });

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(
      `[API RESPONSE] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs.toFixed(1)}ms)`,
    );
  });

  next();
});

// Serve static files for testing
app.use(express.static("public"));

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "AI Fitness Backend API is running!" });
});

// Health check route
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// API routes (Phase 1: route design; auth middleware in Phase 3)
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/body-details", bodyDetailsRoutes);
app.use("/api/body-photos", bodyPhotosRoutes);
app.use("/api/workout-plans", workoutPlanRoutes);
app.use("/api/workout-sessions", workoutSessionRoutes);
app.use("/api/home", homeRoutes);

const MISSED_CHECK_MS = 15 * 60 * 1000;
setInterval(() => {
  markMissedPastDueForAllUsers().catch((e) =>
    console.error("[markMissedPastDue:occurrence]", e?.message || e),
  );
  markMissedCalendarDaysForAllUsers().catch((e) =>
    console.error("[markMissedPastDue:calendar]", e?.message || e),
  );
}, MISSED_CHECK_MS);

// Error handling middleware — standardized envelope, no internal leakage
app.use((err, req, res, _next) => {
  const requestId = req.requestId || generateRequestId();
  const status = err.status || (err.name === "ValidationError" ? 400 : err.name === "CastError" ? 400 : err.code === 11000 ? 409 : 500);

  if (status >= 500) {
    console.error(`[ERROR] ${requestId}`, err.stack || err.message || err);
  }

  const body = formatErrorResponse(err, requestId);
  return res.status(status).json(body);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: "NOT_FOUND",
    message: "Route not found",
    retryable: false,
    requestId: req.requestId,
  });
});

// Start server
const startServer = async () => {
  try {
    await connectDB();

    startWorkoutGenWorker();
    startRefinementWorker();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Graceful shutdown
async function shutdownAll() {
  await Promise.all([
    closeWorkoutGenWorker(),
    closeRefinementWorker(),
    closeQueues(),
  ]);
  await Promise.all([disconnectDB(), disconnectRedis()]);
}

process.on("SIGINT", async () => {
  console.log("Received SIGINT. Shutting down gracefully...");
  await shutdownAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM. Shutting down gracefully...");
  await shutdownAll();
  process.exit(0);
});

startServer();
