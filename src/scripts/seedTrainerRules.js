/**
 * Seed script — reads the trainer rules document and upserts one row per
 * catalogKey into the TrainerRules collection.
 *
 * Usage:
 *   node src/scripts/seedTrainerRules.js
 *
 * Safe to re-run: uses upsert keyed on catalogKey.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { connectDB, disconnectDB } from '../config/database.js';
import TrainerRules from '../models/TrainerRules.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, '../../docs');

const CATALOG_KEYS = ['male_gym', 'male_home', 'female_gym', 'female_home'];

const RULES_FILES = {
  default: path.join(DOCS_ROOT, 'Male Gym', 'Rules & Scenarios'),
  // Add per-catalog rule files here when they exist:
  // female_gym: path.join(DOCS_ROOT, 'Female Gym', 'Rules-FemaleGym'),
};

async function main() {
  await connectDB();
  console.log('Connected to MongoDB\n');

  const defaultContent = fs.readFileSync(RULES_FILES.default, 'utf-8');
  let upserted = 0;

  for (const key of CATALOG_KEYS) {
    const filePath = RULES_FILES[key];
    const content = filePath && fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf-8')
      : defaultContent;

    await TrainerRules.updateOne(
      { catalogKey: key },
      { $set: { content, version: 1 } },
      { upsert: true },
    );

    console.log(`  Upserted rules for ${key} (${content.length} chars)`);
    upserted++;
  }

  console.log(`\nDone — ${upserted} trainer rule documents upserted`);
  await disconnectDB();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
