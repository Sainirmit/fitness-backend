import { Queue } from "bullmq";
import { createBullMQConnection } from "../config/bullmq.js";

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { count: 200, age: 86_400 },
  removeOnFail: { count: 500 },
};

export const workoutGenQueue = new Queue("workout-gen", {
  connection: createBullMQConnection(),
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

export const refinementQueue = new Queue("photo-refinement", {
  connection: createBullMQConnection(),
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

export async function closeQueues() {
  await Promise.all([
    workoutGenQueue.close(),
    refinementQueue.close(),
  ]);
}
