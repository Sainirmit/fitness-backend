/**
 * Async orchestrator for the two-stage body-photo refinement pipeline.
 *
 * Stage 1: Vision LLM analyzes front + side photos → structured profile.
 * Stage 2: Workout LLM builds a plan from onboarding + photo profile (archives any existing active plan).
 *
 * On failure the current active plan is left untouched.
 */

import { analyzeBodyPhotos } from "./bodyPhotoAnalysis.js";
import { generateRefinedWorkoutPlan } from "./workoutPlanGeneration.js";
import BodyPhotos from "../models/BodyPhotos.js";
import WorkoutPlan from "../models/WorkoutPlan.js";
import User from "../models/User.js";
import { getAccessSignedUrl, extractS3KeyFromUrl } from "../config/s3.js";
import { refinementQueue } from "../queues/workoutGenQueue.js";

/**
 * Run the full photo-refinement pipeline.
 *
 * @param {string|ObjectId} userId
 * @param {string|ObjectId} bodyPhotosId
 * @returns {Promise<{ analysis: object, plan: object }>}
 */
export async function runPhotoRefinement(userId, bodyPhotosId) {
  const logCtx = { userId: String(userId), bodyPhotosId: String(bodyPhotosId) };
  console.log("[PhotoRefinement] start", logCtx);

  // Atomically claim the job — prevents duplicate concurrent runs.
  const photos = await BodyPhotos.findOneAndUpdate(
    { _id: bodyPhotosId, user: userId, analysisStatus: { $ne: "processing" } },
    { $set: { analysisStatus: "processing", analysisError: null } },
    { new: true },
  );

  if (!photos) {
    throw Object.assign(
      new Error("Body photos not found or already being processed"),
      { status: 409 },
    );
  }

  try {
    // ── Signed URLs for temporary vision-model access ──
    const frontKey = extractS3KeyFromUrl(photos.frontImageUrl);
    const sideKey = extractS3KeyFromUrl(photos.sideImageUrl);

    if (!frontKey || !sideKey) {
      throw Object.assign(
        new Error("Missing image URLs on BodyPhotos document"),
        { status: 400 },
      );
    }

    const [frontSignedUrl, sideSignedUrl] = await Promise.all([
      getAccessSignedUrl(frontKey),
      getAccessSignedUrl(sideKey),
    ]);

    // ── Stage 1: Vision analysis ──
    const analysis = await analyzeBodyPhotos(frontSignedUrl, sideSignedUrl);

    // Persist analysis (IDs only — no raw image URLs logged).
    await BodyPhotos.findByIdAndUpdate(bodyPhotosId, {
      $set: {
        analysisStatus: "completed",
        analysisSummary: {
          posture: analysis.posture,
          muscleBalance: analysis.muscleBalance,
          bodyComposition: analysis.bodyComposition,
          movementRiskFlags: analysis.movementRiskFlags,
          overallConfidence: analysis.overallConfidence,
          qualityFlags: analysis.qualityFlags,
          summary: analysis.summary,
          trainingRecommendations: analysis.trainingRecommendations,
        },
        analysisCompletedAt: new Date(),
        analysisError: null,
      },
      $inc: { analysisVersion: 1 },
    });

    console.log(
      "[PhotoRefinement] stage 1 complete — analysis persisted",
      logCtx,
    );

    // ── Stage 2: Refined plan generation ──
    const user = await User.findById(userId);
    if (!user) {
      throw Object.assign(new Error("User not found"), { status: 404 });
    }

    const currentPlan = await WorkoutPlan.findOne({
      user: userId,
      status: "active",
    }).sort({ generatedAt: -1 });

    if (!currentPlan) {
      console.log(
        "[PhotoRefinement] no active plan — creating first plan from photo analysis",
        logCtx,
      );
    }

    const result = await generateRefinedWorkoutPlan(
      user,
      analysis,
      currentPlan?._id ?? null,
      bodyPhotosId,
    );

    console.log("[PhotoRefinement] completed", {
      ...logCtx,
      newPlanId: result.workoutPlan._id?.toString(),
    });

    return { analysis, plan: result };
  } catch (err) {
    // Mark analysis as failed — active plan stays untouched (archive only happens
    // inside the plan-creation transaction on success).
    const errorCode = err.errorCode || "INTERNAL_ERROR";
    const errorDetails = err.errorDetails || null;

    await BodyPhotos.findByIdAndUpdate(bodyPhotosId, {
      $set: {
        analysisStatus: "failed",
        analysisError: err.message || "Unknown error",
        analysisErrorCode: errorCode,
        ...(errorDetails ? { analysisErrorDetails: errorDetails } : {}),
      },
    });

    console.error("[PhotoRefinement] failed", {
      ...logCtx,
      errorCode,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Enqueue a photo-refinement job via BullMQ.
 * The worker picks it up, retries on failure, and logs errors.
 */
export async function enqueueRefinement(userId, bodyPhotosId) {
  await refinementQueue.add("refine", {
    userId: String(userId),
    bodyPhotosId: String(bodyPhotosId),
  });
}
