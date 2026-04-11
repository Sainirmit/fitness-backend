import { Worker } from "bullmq";
import { createBullMQConnection } from "../config/bullmq.js";
import { generateCalendarWorkoutPlan } from "../services/workoutPlanGeneration.js";
import WorkoutPlan from "../models/WorkoutPlan.js";
import User from "../models/User.js";

const CONCURRENCY = Number(process.env.BULLMQ_CONCURRENCY) || 1;

async function processCalendarGeneration(job) {
  const { userId, placeholderPlanId, todayDateKey, timeZone } = job.data;

  console.log("[WorkoutGen:Worker] processing", {
    jobId: job.id,
    userId,
    placeholderPlanId,
    attempt: job.attemptsMade + 1,
  });

  const user = await User.findById(userId);
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }

  const result = await generateCalendarWorkoutPlan(user, todayDateKey, timeZone);

  await WorkoutPlan.findByIdAndDelete(placeholderPlanId);

  console.log("[WorkoutGen:Worker] completed", {
    jobId: job.id,
    realPlanId: result.workoutPlan._id?.toString(),
  });
}

let worker = null;

export function startWorkoutGenWorker() {
  worker = new Worker("workout-gen", processCalendarGeneration, {
    connection: createBullMQConnection(),
    concurrency: CONCURRENCY,
  });

  worker.on("failed", async (job, err) => {
    const isFinalAttempt = job.attemptsMade >= (job.opts?.attempts ?? 3);
    console.error("[WorkoutGen:Worker] attempt failed", {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      final: isFinalAttempt,
      error: err?.message,
    });

    if (isFinalAttempt) {
      const { placeholderPlanId } = job.data;
      await WorkoutPlan.findByIdAndUpdate(placeholderPlanId, {
        $set: {
          status: "failed",
          generationError: "Plan generation failed. Please try again later.",
        },
      }).catch((updateErr) =>
        console.error("[WorkoutGen:Worker] failed to mark placeholder", updateErr?.message),
      );
    }
  });

  worker.on("error", (err) => {
    console.error("[WorkoutGen:Worker] worker error", err?.message);
  });

  console.log("[WorkoutGen:Worker] started", { concurrency: CONCURRENCY });
  return worker;
}

export async function closeWorkoutGenWorker() {
  if (worker) await worker.close();
}
