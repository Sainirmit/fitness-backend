import { Worker } from "bullmq";
import { createBullMQConnection } from "../config/bullmq.js";
import { runPhotoRefinement } from "../services/photoRefinementOrchestrator.js";

const CONCURRENCY = Number(process.env.BULLMQ_CONCURRENCY) || 1;

async function processRefinement(job) {
  const { userId, bodyPhotosId } = job.data;

  console.log("[Refinement:Worker] processing", {
    jobId: job.id,
    userId,
    bodyPhotosId,
    attempt: job.attemptsMade + 1,
  });

  const result = await runPhotoRefinement(userId, bodyPhotosId);

  if (result?.skipped) {
    console.log("[Refinement:Worker] skipped (duplicate or in-flight)", {
      jobId: job.id,
      userId,
      bodyPhotosId,
      analysisStatus: result.analysisStatus,
    });
    return;
  }

  console.log("[Refinement:Worker] completed", {
    jobId: job.id,
    userId,
    bodyPhotosId,
  });
}

let worker = null;

export function startRefinementWorker() {
  worker = new Worker("photo-refinement", processRefinement, {
    connection: createBullMQConnection(),
    concurrency: CONCURRENCY,
  });

  worker.on("failed", (job, err) => {
    console.error("[Refinement:Worker] attempt failed", {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      final: job?.attemptsMade >= (job?.opts?.attempts ?? 3),
      error: err?.message,
    });
  });

  worker.on("error", (err) => {
    console.error("[Refinement:Worker] worker error", err?.message);
  });

  console.log("[Refinement:Worker] started", { concurrency: CONCURRENCY });
  return worker;
}

export async function closeRefinementWorker() {
  if (worker) await worker.close();
}
