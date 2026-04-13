/**
 * Seed script — parses Metadata-* docs and upserts exercises into MongoDB.
 *
 * Usage:
 *   node src/scripts/seedExercises.js                          # seed all catalogs with docs
 *   node src/scripts/seedExercises.js --catalog male_gym       # seed only male_gym
 *
 * Safe to re-run: uses upsert keyed on (name + catalogKey).
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

const CATALOG_FILES = {
  male_gym: path.join(DOCS_ROOT, "Male Gym", "Metadata-MenGym"),
  male_home: path.join(DOCS_ROOT, "Male Home", "Metadata-MenHome"),
  // Add remaining catalogs as their metadata files are created:
  // female_gym:  path.join(DOCS_ROOT, 'Female Gym', 'Metadata-FemaleGym'),
  // female_home: path.join(DOCS_ROOT, 'Female Home', 'Metadata-FemaleHome'),
};

// ---------------------------------------------------------------------------
// Metadata parser
// ---------------------------------------------------------------------------

function parseValue(raw) {
  if (raw === "null" || raw === "") return null;
  if (raw.startsWith("[")) {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const num = Number(raw);
  if (!Number.isNaN(num) && raw !== "") return num;
  return raw;
}

function parseMetadataFile(text) {
  const exercises = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith("name:")) {
      const exercise = {};
      let currentKey = null;

      while (i < lines.length) {
        const line = lines[i];
        const lt = line.trim();

        if (lt.match(/^━+$/)) break;

        const kv = lt.match(/^(\w+):\s*(.*)$/);
        if (kv) {
          currentKey = kv[1];
          const val = kv[2].trim();
          exercise[currentKey] =
            currentKey === "description" ? val : parseValue(val);
        } else if (currentKey === "description" && lt) {
          exercise.description += " " + lt;
        }
        i++;
      }

      if (exercise.name) exercises.push(exercise);
    } else {
      i++;
    }
  }

  return exercises;
}

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

async function seedCatalog(catalogKey, filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠  File not found, skipping: ${filePath}`);
    return 0;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = parseMetadataFile(raw);
  console.log(
    `  Parsed ${parsed.length} exercises from ${path.basename(filePath)}`,
  );

  let upserted = 0;

  for (const ex of parsed) {
    const filter = { name: ex.name, catalogKey };
    const lowerName = String(ex.name || "").trim().toLowerCase();
    const doc = {
      name: ex.name,
      description: ex.description || "",
      videoUrl: `https://cdn.mytrainrai.com/videos/${catalogKey}/${encodeURIComponent(ex.name)}.mp4`,
      // Jump Rope is tracked as reps-only in the app.
      exerciseType:
        lowerName === "jump rope" ? "bodyweight" : ex.exerciseType || "strength",
      muscleGroups: ex.muscleGroups || [],
      equipment: ex.equipment || [],
      difficultyLevel: ex.difficultyLevel || "beginner",
      defaultSets: ex.defaultSets ?? null,
      defaultRepMin: ex.defaultRepMin ?? null,
      defaultRepMax: ex.defaultRepMax ?? null,
      defaultRestSeconds: ex.defaultRestSeconds ?? 60,
      defaultDurationMinutes: ex.defaultDurationMinutes ?? null,
      defaultSpeed: ex.defaultSpeed ?? null,
      defaultIncline: ex.defaultIncline ?? null,
      catalogKey,
      isActive: true,
    };

    await Exercise.updateOne(filter, { $set: doc }, { upsert: true });
    upserted++;
  }

  return upserted;
}

async function main() {
  const onlyCatalog = process.argv.includes("--catalog")
    ? process.argv[process.argv.indexOf("--catalog") + 1]
    : null;

  await connectDB();
  console.log("Connected to MongoDB\n");

  const catalogs = onlyCatalog
    ? { [onlyCatalog]: CATALOG_FILES[onlyCatalog] }
    : CATALOG_FILES;

  let total = 0;
  for (const [key, filePath] of Object.entries(catalogs)) {
    if (!filePath) {
      console.log(`  Skipping ${key} — no file path configured`);
      continue;
    }
    console.log(`Seeding catalog: ${key}`);
    const count = await seedCatalog(key, filePath);
    console.log(`  Upserted ${count} exercises\n`);
    total += count;
  }

  console.log(`Done — ${total} exercises total`);
  await disconnectDB();
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
