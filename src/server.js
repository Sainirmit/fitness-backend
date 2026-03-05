import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "./config/database.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import bodyDetailsRoutes from "./routes/bodyDetailsRoutes.js";
import bodyPhotosRoutes from "./routes/bodyPhotosRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Start server
const startServer = async () => {
  try {
    await connectDB();
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
process.on("SIGINT", async () => {
  console.log("Received SIGINT. Shutting down gracefully...");
  await disconnectDB();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM. Shutting down gracefully...");
  await disconnectDB();
  process.exit(0);
});

startServer();
