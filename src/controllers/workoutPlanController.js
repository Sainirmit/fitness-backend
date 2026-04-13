import WorkoutPlan from "../models/WorkoutPlan.js";
import WorkoutDay from "../models/WorkoutDay.js";
import WorkoutDayExercise from "../models/WorkoutDayExercise.js";
import BodyPhotos from "../models/BodyPhotos.js";
import { workoutGenQueue } from "../queues/workoutGenQueue.js";
import {
  ensureOccurrences,
  listOccurrencesInRange,
  resetTemplateStatusesForActivePlan,
} from "../services/workoutOccurrenceService.js";
import {
  resolveTimeZone,
  syncUserTimeZoneFromHeader,
} from "../utils/timezone.js";
import {
  weekKeysForDate,
  dateKeyInTimeZone,
} from "../services/homeDashboardService.js";

const WEEKDAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function weekdayInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  })
    .format(date)
    .toLowerCase()
    .slice(0, 3);
}

/**
 * Build slots for the next N scheduled training dates by walking the calendar
 * and matching user.workoutDays (e.g. ["mon","wed","fri"]).
 * Only used for template-shaped plans.
 */
function buildAutoOccurrenceSlots(days, workoutDays, timeZone) {
  const normalizedWorkoutDays = (workoutDays || [])
    .map((d) =>
      String(d || "")
        .toLowerCase()
        .trim(),
    )
    .filter((d) => WEEKDAY_ORDER.includes(d));
  const allowed = new Set(normalizedWorkoutDays);
  if (!days?.length || allowed.size === 0) return [];

  const slots = [];
  let cursor = new Date();
  let dayIndex = 0;

  for (let i = 0; i < 60 && slots.length < days.length; i++) {
    const weekday = weekdayInTimeZone(cursor, timeZone);
    if (allowed.has(weekday)) {
      slots.push({
        workoutDayId: days[dayIndex]._id,
        scheduledDateKey: dateKeyInTimeZone(cursor, timeZone),
        timeZone,
      });
      dayIndex += 1;
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return slots;
}

/**
 * POST /api/workout-plans/generate
 *
 * Queues an AI workout plan generation for the authenticated user.
 * Returns immediately with a placeholder plan (status "generating").
 * Client polls GET /api/workout-plans/generation-status until complete.
 */
export const generate = async (req, res, next) => {
  try {
    const user = req.user;
    await syncUserTimeZoneFromHeader(req, user);

    if (!user.hasUnlockedPlan) {
      return res.status(403).json({
        message:
          "Unlock your plan before generating a workout. Complete payment first.",
      });
    }

    const missing = [];
    if (!user.fitnessGoals?.length) missing.push("fitnessGoals");
    if (!user.fitnessLevel) missing.push("fitnessLevel");
    if (!user.workoutEnvironment) missing.push("workoutEnvironment");
    if (!user.workoutDays?.length) missing.push("workoutDays");
    if (!user.focusAreas?.length) missing.push("focusAreas");

    if (missing.length > 0) {
      return res.status(400).json({
        message: `Complete onboarding first. Missing fields: ${missing.join(", ")}.`,
      });
    }

    const STALE_GENERATING_MS = 45 * 60 * 1000;
    const staleCutoff = new Date(Date.now() - STALE_GENERATING_MS);
    await WorkoutPlan.deleteMany({
      user: user._id,
      status: "generating",
      generatedAt: { $lt: staleCutoff },
    });

    const jobId = `workout-gen-${user._id}`;
    let existingJob;
    try {
      existingJob = await workoutGenQueue.getJob(jobId);
    } catch {
      return res.status(503).json({
        code: "QUEUE_UNAVAILABLE",
        message: "Generation queue is temporarily unavailable.",
        retryable: true,
      });
    }

    if (existingJob) {
      const queueState = await existingJob.getState();
      if (queueState === "active") {
        return res.status(409).json({
          message:
            "Plan generation is already in progress. Wait for it to finish, then try again.",
        });
      }
      try {
        await existingJob.remove();
      } catch (removeErr) {
        console.warn("[workout-plans/generate] could not remove prior job", {
          jobId,
          queueState,
          message: removeErr?.message,
        });
      }
    }

    await WorkoutPlan.updateMany(
      { user: user._id, status: "active" },
      { $set: { status: "archived" } },
    );

    const timeZone = resolveTimeZone(req, user);
    const todayDateKey = dateKeyInTimeZone(new Date(), timeZone);

    const placeholderPlan = await WorkoutPlan.create({
      user: user._id,
      name: "Generating your plan…",
      status: "generating",
      planShape: "calendar",
      generatedAt: new Date(),
    });

    await workoutGenQueue.add(
      "calendar",
      {
        userId: String(user._id),
        placeholderPlanId: String(placeholderPlan._id),
        todayDateKey,
        timeZone,
      },
      { jobId },
    );

    return res.status(202).json({
      message: "Plan generation started. Poll generation-status for progress.",
      workoutPlanId: placeholderPlan._id,
      status: "generating",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/workout-plans/generation-status
 *
 * Status from BullMQ only (job id `workout-gen-<userId>`, same as POST /generate).
 * No job in Redis → `idle` (or job already pruned) — use GET /api/workout-plans/current.
 */
export const getGenerationStatus = async (req, res, next) => {
  try {
    const jobKey = `workout-gen-${req.user._id}`;

    let job;
    try {
      job = await workoutGenQueue.getJob(jobKey);
    } catch {
      return res.status(503).json({
        code: "QUEUE_UNAVAILABLE",
        message: "Generation queue is temporarily unavailable.",
        retryable: true,
      });
    }

    if (!job) {
      return res.status(200).json({ status: "idle" });
    }

    const queueState = await job.getState();

    if (queueState === "completed") {
      const rv = job.returnvalue;
      const workoutPlanId =
        rv && typeof rv === "object" && rv.workoutPlanId != null
          ? String(rv.workoutPlanId)
          : null;

      // Stale Redis job: jobId is reused per user; a previous "completed" job
      // can remain in Redis while Mongo already has a new generating placeholder.
      const generating = await WorkoutPlan.findOne({
        user: req.user._id,
        status: "generating",
      })
        .select("_id")
        .lean();

      if (generating) {
        const jobPlaceholder = job.data?.placeholderPlanId;
        const matchesCurrentPlaceholder =
          jobPlaceholder &&
          String(jobPlaceholder) === String(generating._id);
        if (!matchesCurrentPlaceholder || !workoutPlanId) {
          return res.status(200).json({
            status: "generating",
            queueState: "stale_completed",
          });
        }
      }

      return res.status(200).json({
        status: "completed",
        ...(workoutPlanId ? { workoutPlanId } : {}),
      });
    }

    if (queueState === "failed") {
      return res.status(200).json({
        status: "failed",
        code: "GENERATION_FAILED",
        error:
          job.failedReason || "Plan generation failed. Please try again later.",
      });
    }

    return res.status(200).json({
      status: "generating",
      queueState,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/workout-plans/current
 *
 * Returns the user's current active workout plan with all days and exercises.
 */
export const getCurrent = async (req, res, next) => {
  try {
    await syncUserTimeZoneFromHeader(req, req.user);
    const timeZone = resolveTimeZone(req, req.user);

    const workoutPlan = await WorkoutPlan.findOne({
      user: req.user._id,
      status: "active",
    })
      .sort({ generatedAt: -1 })
      .lean();

    if (!workoutPlan) {
      const generating = await WorkoutPlan.findOne({
        user: req.user._id,
        status: "generating",
      }).lean();
      if (generating) {
        return res.status(202).json({
          message:
            "Your plan is being generated. Poll generation-status for progress.",
          workoutPlanId: generating._id,
          status: "generating",
        });
      }
      return res.status(404).json({ message: "No active workout plan found." });
    }

    const isCalendar = workoutPlan.planShape === "calendar";

    // For calendar plans, default to current week; allow startDate/endDate overrides.
    const todayKey = dateKeyInTimeZone(new Date(), timeZone);
    const weekKeys = weekKeysForDate(todayKey);
    const startDate = req.query.startDate || weekKeys[0];
    const endDate = req.query.endDate || weekKeys[6];

    let daysQuery;
    if (isCalendar) {
      daysQuery = WorkoutDay.find({
        workoutPlan: workoutPlan._id,
        scheduledDateKey: { $gte: startDate, $lte: endDate },
      }).sort({ scheduledDateKey: 1 });
    } else {
      daysQuery = WorkoutDay.find({ workoutPlan: workoutPlan._id }).sort({
        dayNumber: 1,
      });
    }

    const days = await daysQuery.lean();
    const dayIds = days.filter((d) => !d.isRestDay).map((d) => d._id);

    const dayExercises = await WorkoutDayExercise.find({
      workoutDay: { $in: dayIds },
    })
      .populate(
        "exercise",
        "name description exerciseType muscleGroups equipment difficultyLevel videoUrl thumbnailUrl defaultSets defaultRepMin defaultRepMax defaultRestSeconds",
      )
      .sort({ orderInDay: 1 })
      .lean();

    const exercisesByDay = {};
    for (const de of dayExercises) {
      const key = de.workoutDay.toString();
      if (!exercisesByDay[key]) exercisesByDay[key] = [];
      exercisesByDay[key].push({
        ...de,
        category: de.setType || "main",
      });
    }

    const populatedDays = days.map((d) => ({
      ...d,
      exercises: exercisesByDay[d._id.toString()] || [],
    }));

    if (isCalendar) {
      return res.status(200).json({
        workoutPlan,
        days: populatedDays,
        window: { timeZone, startDate, endDate },
      });
    }

    // Template plan: include occurrences for backward compat
    const occurrences = await listOccurrencesInRange(
      req.user._id,
      weekKeys[0],
      weekKeys[6],
    );

    return res.status(200).json({
      workoutPlan,
      days: populatedDays,
      occurrences,
      occurrenceWindow: {
        timeZone,
        startDate: weekKeys[0],
        endDate: weekKeys[6],
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/workout-plans/refinement-status/:bodyPhotosId
 *
 * Returns the current refinement status for a given photo set.
 * Client can poll this after uploading photos to track progress.
 *
 * Response 200:
 *   { status, error?, completedAt?, resultPlanId? }
 */
/**
 * GET /api/workout-plans/occurrences?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export const listOccurrences = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({
        message:
          "Query params startDate and endDate (YYYY-MM-DD) are required.",
      });
    }
    const occurrences = await listOccurrencesInRange(
      req.user._id,
      startDate,
      endDate,
    );
    return res.status(200).json({ occurrences });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
};

/**
 * POST /api/workout-plans/occurrences/ensure
 * Body: { slots: [{ workoutDayId, scheduledDateKey, timeZone }] }
 */
export const ensureOccurrenceSlots = async (req, res, next) => {
  try {
    const { slots } = req.body;
    if (!Array.isArray(slots) || slots.length === 0) {
      return res
        .status(400)
        .json({ message: "slots (non-empty array) is required." });
    }
    await syncUserTimeZoneFromHeader(req, req.user);
    const fallbackTz = resolveTimeZone(req, req.user);
    const normalizedSlots = slots.map((slot) => ({
      ...slot,
      timeZone:
        typeof slot?.timeZone === "string" && slot.timeZone.trim()
          ? slot.timeZone.trim()
          : fallbackTz,
    }));
    const occurrences = await ensureOccurrences(req.user._id, normalizedSlots);
    return res.status(200).json({ occurrences });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
};

/**
 * POST /api/workout-plans/current/reset-template-status
 * Sets every WorkoutDay.status on the active plan to planned (call at week boundary).
 */
export const resetTemplateStatus = async (req, res, next) => {
  try {
    const result = await resetTemplateStatusesForActivePlan(req.user._id);
    return res.status(200).json({
      message: "Template day statuses reset to planned.",
      ...result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
};

export const getRefinementStatus = async (req, res, next) => {
  try {
    const { bodyPhotosId } = req.params;

    const photos = await BodyPhotos.findOne({
      _id: bodyPhotosId,
      user: req.user._id,
    });

    if (!photos) {
      return res.status(404).json({ message: "Body photos not found." });
    }

    const response = {
      status: photos.analysisStatus || "none",
      error: photos.analysisError || null,
      // Machine-readable code: 'INVALID_PHOTOS' | 'LOW_CONFIDENCE' | 'SCHEMA_ERROR' | 'INTERNAL_ERROR'
      errorCode: photos.analysisErrorCode || null,
      // Structured details for the frontend (e.g. which quality checks failed).
      errorDetails: photos.analysisErrorDetails || null,
      completedAt: photos.analysisCompletedAt || null,
    };

    if (photos.analysisStatus === "completed") {
      const refinedPlan = await WorkoutPlan.findOne({
        user: req.user._id,
        sourceBodyPhotos: bodyPhotosId,
        generationType: "photo_refinement",
      })
        .sort({ generatedAt: -1 })
        .select("_id status generatedAt name");

      if (refinedPlan) {
        response.resultPlanId = refinedPlan._id;
        response.resultPlanStatus = refinedPlan.status;
      }
    }

    return res.status(200).json(response);
  } catch (err) {
    next(err);
  }
};
