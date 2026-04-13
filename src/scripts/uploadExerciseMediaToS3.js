/**
 * Upload exercise videos + thumbnails from docs/All Videos with Thumbnails to S3.
 *
 * Features:
 * - Scans each exercise folder and expects exactly one .mp4 and one .jpg
 * - Uploads files under a deterministic S3 key prefix
 * - Writes a manifest JSON with generated videoUrl + thumbnailUrl
 * - Optional DB sync for Exercise docs (`--sync-db`)
 *
 * Usage:
 *   node src/scripts/uploadExerciseMediaToS3.js --dry-run
 *   node src/scripts/uploadExerciseMediaToS3.js --prefix exercises
 *   node src/scripts/uploadExerciseMediaToS3.js --prefix exercises --sync-db
 *   node src/scripts/uploadExerciseMediaToS3.js --sync-db-only
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  PutObjectCommand,
  S3Client,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { BUCKET_NAME } from "../config/s3.js";
import { connectDB, disconnectDB } from "../config/database.js";
import Exercise from "../models/Exercise.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const SOURCE_ROOT = path.join(REPO_ROOT, "docs", "All Videos with Thumbnails");
const DEFAULT_PREFIX = "exercise-media";
const DEFAULT_MANIFEST_PATH = path.join(
  REPO_ROOT,
  "docs",
  "exercise-media-upload-manifest.json",
);

function parseArg(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getContentType(fileName) {
  if (fileName.toLowerCase().endsWith(".mp4")) return "video/mp4";
  if (fileName.toLowerCase().endsWith(".jpg")) return "image/jpeg";
  return "application/octet-stream";
}

function toS3Url(bucket, region, key) {
  const encodedKey = key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

function normalizeCatalogFolder(folderName) {
  const normalized = folderName.trim().toLowerCase();
  if (normalized.includes("female gym")) return "female_gym";
  if (normalized.includes("male gym")) return "male_gym";
  if (normalized.includes("home common")) return "home_common";
  return null;
}

function gatherPairs(rootDir) {
  const pairs = [];
  const issues = [];
  const topLevel = fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const catalogDir of topLevel) {
    const catalogKey = normalizeCatalogFolder(catalogDir);
    if (!catalogKey) {
      issues.push({
        type: "unknown_catalog_dir",
        path: catalogDir,
      });
      continue;
    }

    const catalogAbs = path.join(rootDir, catalogDir);
    const stack = [catalogAbs];
    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile()).map((e) => e.name);
      const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      const mp4s = files.filter((f) => f.toLowerCase().endsWith(".mp4"));
      const jpgs = files.filter((f) => f.toLowerCase().endsWith(".jpg"));

      if (mp4s.length || jpgs.length) {
        const relDir = path.relative(rootDir, current);
        if (mp4s.length !== 1 || jpgs.length !== 1) {
          issues.push({
            type: "invalid_media_pair",
            path: relDir,
            mp4Count: mp4s.length,
            jpgCount: jpgs.length,
          });
        } else {
          pairs.push({
            catalogKey,
            exerciseName: path.basename(current).trim(),
            relativeDir: relDir,
            videoFileName: mp4s[0],
            thumbnailFileName: jpgs[0],
            videoPath: path.join(current, mp4s[0]),
            thumbnailPath: path.join(current, jpgs[0]),
          });
        }
      }

      for (const dir of subdirs) stack.push(path.join(current, dir));
    }
  }

  return { pairs, issues };
}

async function runWithConcurrency(items, worker, concurrency) {
  const running = new Set();
  const results = [];

  for (const item of items) {
    const p = Promise.resolve().then(() => worker(item));
    results.push(p);
    running.add(p);
    p.finally(() => running.delete(p));
    if (running.size >= concurrency) {
      await Promise.race(running);
    }
  }

  return Promise.all(results);
}

async function purgePrefix(s3, bucket, prefix) {
  let continuationToken = undefined;
  let deletedCount = 0;

  do {
    const listRes = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}/`,
        ContinuationToken: continuationToken,
      }),
    );

    const keys = (listRes.Contents || []).map((obj) => ({ Key: obj.Key }));
    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys, Quiet: true },
        }),
      );
      deletedCount += keys.length;
    }

    continuationToken = listRes.IsTruncated
      ? listRes.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return deletedCount;
}

async function syncDb(manifestRows) {
  await connectDB();
  let updated = 0;
  let missing = 0;

  for (const row of manifestRows) {
    const targetCatalogs =
      row.catalogKey === "home_common"
        ? ["male_home", "female_home"]
        : [row.catalogKey];

    for (const catalogKey of targetCatalogs) {
      const res = await Exercise.updateOne(
        { name: row.exerciseName, catalogKey },
        { $set: { videoUrl: row.videoUrl, thumbnailUrl: row.thumbnailUrl } },
      );
      if ((res.matchedCount ?? 0) === 0) {
        missing += 1;
      } else if ((res.modifiedCount ?? 0) > 0) {
        updated += 1;
      }
    }
  }

  await disconnectDB();
  return { updated, missing };
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const syncDbFlag = hasFlag("--sync-db");
  const syncDbOnly = hasFlag("--sync-db-only");
  const prefix = (parseArg("--prefix", DEFAULT_PREFIX) ?? DEFAULT_PREFIX).replace(
    /^\/+|\/+$/g,
    "",
  );
  const concurrency = Number(parseArg("--concurrency", "2")) || 2;
  const maxRetries = Number(parseArg("--retries", "4")) || 4;
  const manifestPath = parseArg("--manifest", DEFAULT_MANIFEST_PATH) ?? DEFAULT_MANIFEST_PATH;
  const region = process.env.AWS_REGION;

  if (syncDbOnly && dryRun) {
    throw new Error("--sync-db-only cannot be combined with --dry-run");
  }
  if (syncDbOnly && !syncDbFlag) {
    throw new Error("--sync-db-only requires --sync-db");
  }

  if (!syncDbOnly) {
    if (!fs.existsSync(SOURCE_ROOT)) {
      throw new Error(`Source folder not found: ${SOURCE_ROOT}`);
    }
    if (!region) {
      throw new Error("AWS_REGION is required");
    }
    if (!BUCKET_NAME) {
      throw new Error("AWS_BUCKET_NAME is required");
    }
  }

  const manifestRows = [];

  if (syncDbOnly) {
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest not found: ${manifestPath}`);
    }
    const parsedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (!Array.isArray(parsedManifest) || parsedManifest.length === 0) {
      throw new Error("Manifest file is empty or invalid.");
    }
    manifestRows.push(...parsedManifest);
    console.log(`Mode: SYNC DB ONLY`);
    console.log(`Loaded ${manifestRows.length} rows from manifest: ${manifestPath}`);
  } else {
    const { pairs, issues } = gatherPairs(SOURCE_ROOT);
    if (issues.length) {
      console.error("Found folder issues:");
      for (const issue of issues.slice(0, 20)) {
        console.error(issue);
      }
      throw new Error(`Aborting due to ${issues.length} media-structure issue(s).`);
    }

    console.log(`Discovered ${pairs.length} exercise folders with valid media pairs.`);
    console.log(`Mode: ${dryRun ? "DRY RUN (no upload)" : "UPLOAD"}`);
    console.log(`S3 target: s3://${BUCKET_NAME}/${prefix}/...`);
    console.log(`Concurrency: ${concurrency}`);
    console.log(`Retries per file: ${maxRetries}`);

    const scriptS3Client = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      // Avoid SDK auto-retrying consumed streams; we handle retries with fresh streams.
      maxAttempts: 1,
    });

    if (!dryRun) {
      console.log(`Cleaning existing objects under s3://${BUCKET_NAME}/${prefix}/ ...`);
      const deleted = await purgePrefix(scriptS3Client, BUCKET_NAME, prefix);
      console.log(`Deleted ${deleted} old object(s) from previous runs.`);
    }

    async function uploadWithRetry(localPath, key) {
      const contentType = getContentType(localPath);

      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          const body = fs.createReadStream(localPath);
          const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            Body: body,
            ContentType: contentType,
          });
          await scriptS3Client.send(command);
          return;
        } catch (err) {
          const isLast = attempt === maxRetries;
          const message = err?.message || String(err);
          if (isLast) {
            throw new Error(`Failed upload ${key}: ${message}`);
          }
          const backoffMs = attempt * 1500;
          console.warn(
            `Retrying ${key} (attempt ${attempt}/${maxRetries}) after error: ${message}`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }
    let completed = 0;
    await runWithConcurrency(
      pairs,
      async (pair) => {
        const relDir = pair.relativeDir.split(path.sep).join("/");
        const videoKey = `${prefix}/${relDir}/${pair.videoFileName}`;
        const thumbnailKey = `${prefix}/${relDir}/${pair.thumbnailFileName}`;

        if (!dryRun) {
          await uploadWithRetry(pair.videoPath, videoKey);
          await uploadWithRetry(pair.thumbnailPath, thumbnailKey);
        }

        manifestRows.push({
          catalogKey: pair.catalogKey,
          exerciseName: pair.exerciseName,
          relativeDir: relDir,
          videoKey,
          thumbnailKey,
          videoUrl: toS3Url(BUCKET_NAME, region, videoKey),
          thumbnailUrl: toS3Url(BUCKET_NAME, region, thumbnailKey),
        });
        completed += 1;
        if (completed % 10 === 0 || completed === pairs.length) {
          console.log(`Progress: ${completed}/${pairs.length} exercise pairs uploaded`);
        }
      },
      concurrency,
    );

    manifestRows.sort((a, b) => a.relativeDir.localeCompare(b.relativeDir));
    fs.writeFileSync(manifestPath, JSON.stringify(manifestRows, null, 2), "utf-8");

    console.log(`Manifest written: ${manifestPath}`);
    console.log(`Uploaded pairs: ${manifestRows.length}`);
  }

  if (syncDbFlag) {
    if (dryRun) {
      throw new Error("Cannot use --sync-db with --dry-run");
    }
    const { updated, missing } = await syncDb(manifestRows);
    console.log(`DB sync complete. Updated docs: ${updated}, missing matches: ${missing}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Upload script failed:", err.message);
  process.exit(1);
});

