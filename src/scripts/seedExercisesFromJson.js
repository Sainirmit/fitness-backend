/**
 * Seed/refresh exercise catalogs from JSON files under `docs/All Videos/`.
 *
 * - Ensures every inserted/updated Exercise doc has `catalogKey`.
 * - Removes "legacy" Exercise docs:
 *   - docs with missing/invalid catalogKey
 *   - docs within each catalogKey whose `name` is NOT present in the incoming JSON
 *
 * Usage:
 *   node src/scripts/seedExercisesFromJson.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/database.js";
import Exercise from "../models/Exercise.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "../../docs");

const VALID_CATALOG_KEYS = ["male_gym", "male_home", "female_gym", "female_home"];
const JSON_FILES = {
  male_gym: path.join(DOCS_ROOT, "All Videos", "male-gym-exercises.json"),
  female_gym: path.join(DOCS_ROOT, "All Videos", "female-gym-exercises.json"),
  home_common: path.join(DOCS_ROOT, "All Videos", "home-common-exercises.json"),
};

function coerceExerciseType(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  // Exercise schema enums: ["strength", "cardio", "bodyweight"]
  if (v === "strength" || v === "cardio" || v === "bodyweight") return v;
  // Default to strength if input is missing/unknown.
  return "strength";
}

function normalizeJsonExercise(ex) {
  const name = String(ex?.name ?? "").trim();
  if (!name) return null;
  const lowerName = name.toLowerCase();

  // JSON files include `videoUrl` but it can be empty. Fall back to CDN URL format.
  const videoUrl =
    String(ex?.videoUrl ?? "").trim() ||
    `https://cdn.mytrainrai.com/videos/${currentCatalogKey}/${encodeURIComponent(name)}.mp4`;

  return {
    name,
    description: String(ex?.description ?? "").trim() || "",
    videoUrl,
    thumbnailUrl: String(ex?.thumbnailUrl ?? "").trim() || "",
    // Some conditioning movements are tracked as reps in app UX.
    // Keep them as bodyweight so backend accepts reps-only logging.
    exerciseType:
      lowerName === "jump rope"
        ? "bodyweight"
        : coerceExerciseType(ex?.exerciseType),
    muscleGroups: Array.isArray(ex?.muscleGroups) ? ex.muscleGroups : [],
    equipment: Array.isArray(ex?.equipment) ? ex.equipment : [],
    difficultyLevel: String(ex?.difficultyLevel ?? "").trim().toLowerCase() || "beginner",
    defaultSets: ex?.defaultSets ?? null,
    defaultRepMin: ex?.defaultRepMin ?? null,
    defaultRepMax: ex?.defaultRepMax ?? null,
    defaultRestSeconds: ex?.defaultRestSeconds ?? 60,
    defaultDurationMinutes: ex?.defaultDurationMinutes ?? null,
    defaultSpeed: ex?.defaultSpeed ?? null,
    defaultIncline: ex?.defaultIncline ?? null,
    catalogKey: currentCatalogKey,
    isActive: true,
  };
}

let currentCatalogKey = null;

function loadJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`JSON file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected an array in ${path.basename(filePath)}`);
  }
  return parsed;
}

async function main() {
  await connectDB();
  console.log("Connected to MongoDB");

  // 1) Load all JSON upfront so we can compute allowed `name`s for cleanup.
  const maleGymJson = loadJsonArray(JSON_FILES.male_gym);
  const femaleGymJson = loadJsonArray(JSON_FILES.female_gym);
  const homeCommonJson = loadJsonArray(JSON_FILES.home_common);

  const catalogToJson = {
    male_gym: maleGymJson,
    female_gym: femaleGymJson,
    male_home: homeCommonJson,
    female_home: homeCommonJson,
  };

  const allowedNamesByCatalogKey = {};
  for (const key of VALID_CATALOG_KEYS) {
    const arr = catalogToJson[key] ?? [];
    allowedNamesByCatalogKey[key] = new Set(
      arr.map((ex) => String(ex?.name ?? "").trim()).filter(Boolean),
    );
  }

  // 2) Remove legacy/extra docs.
  //    - Missing/invalid catalogKey
  await Exercise.deleteMany({
    $or: [
      { catalogKey: { $exists: false } },
      { catalogKey: { $nin: VALID_CATALOG_KEYS } },
    ],
  });

  //    - Extra docs within each catalogKey not present in the incoming JSON
  for (const key of VALID_CATALOG_KEYS) {
    const allowedNames = Array.from(allowedNamesByCatalogKey[key]);
    // If the incoming dataset is unexpectedly empty, don't nuke the catalog.
    if (allowedNames.length === 0) {
      console.warn(`  ⚠  No names found for ${key}; skipping catalog cleanup`);
      continue;
    }
    const res = await Exercise.deleteMany({
      catalogKey: key,
      name: { $nin: allowedNames },
    });
    console.log(`  Cleanup ${key}: deleted ${res.deletedCount} legacy docs`);
  }

  // 3) Upsert incoming docs.
  const operations = [];
  for (const key of VALID_CATALOG_KEYS) {
    const arr = catalogToJson[key] ?? [];
    currentCatalogKey = key; // used by normalizeJsonExercise() fallback video URL

    for (const ex of arr) {
      const doc = normalizeJsonExercise(ex);
      if (!doc) continue;

      operations.push({
        updateOne: {
          filter: { name: doc.name, catalogKey: key },
          update: { $set: doc },
          upsert: true,
        },
      });
    }
  }

  if (operations.length === 0) {
    throw new Error("No operations built from JSON inputs; aborting.");
  }

  // bulkWrite is faster than per-document updateOne for large catalogs.
  const CHUNK_SIZE = 500;
  let upsertedLike = 0;
  let modifiedLike = 0;

  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    const res = await Exercise.bulkWrite(chunk, { ordered: false });
    upsertedLike += res.upsertedCount ?? 0;
    modifiedLike += res.modifiedCount ?? 0;
    console.log(
      `  Upsert chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ops=${chunk.length}, upserted=${res.upsertedCount ?? 0}, modified=${res.modifiedCount ?? 0}`,
    );
  }

  // 4) Final sanity summary.
  const counts = await Exercise.aggregate([
    { $match: { catalogKey: { $in: VALID_CATALOG_KEYS } } },
    { $group: { _id: "$catalogKey", count: { $sum: 1 } } },
  ]);

  console.log("Done seeding exercise catalogs.");
  console.log({ upsertedLike, modifiedLike, counts });

  await disconnectDB();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  try {
    // Best effort disconnect.
    await disconnectDB();
  } catch {
    // ignore
  }
  process.exit(1);
});

