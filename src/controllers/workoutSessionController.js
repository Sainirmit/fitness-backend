import {
  startWorkoutSession,
  completeWorkoutSession,
  markMissedPastDueForUser,
  startCalendarWorkoutSession,
  completeCalendarWorkoutSession,
  markMissedCalendarDaysForUser,
} from "../services/workoutOccurrenceService.js";
import {
  upsertSetLog,
  batchUpsertSetLogs,
  computeSessionProgress,
  getSessionDetail,
} from "../services/workoutTrackingService.js";
import WorkoutDay from "../models/WorkoutDay.js";
import WorkoutPlan from "../models/WorkoutPlan.js";
import WorkoutSessionExercise from "../models/WorkoutSessionExercise.js";
import WorkoutSetLog from "../models/WorkoutSetLog.js";
import { resolveTimeZone, syncUserTimeZoneFromHeader } from "../utils/timezone.js";

/**
 * POST /api/workout-sessions/start
 * Body: { workoutDayId, scheduledDateKey? (YYYY-MM-DD) }
 */
export const start = async (req, res, next) => {
  try {
    const { workoutDayId, scheduledDateKey } = req.body;
    if (!workoutDayId) {
      return res.status(400).json({ message: "workoutDayId is required." });
    }
    await syncUserTimeZoneFromHeader(req, req.user);
    const timeZone = resolveTimeZone(req, req.user);

    const isCalendar = await isCalendarWorkoutDay(workoutDayId);

    let result;
    if (isCalendar) {
      result = await startCalendarWorkoutSession(req.user._id, {
        workoutDayId,
        timeZone,
      });
    } else {
      result = await startWorkoutSession(req.user._id, {
        workoutDayId,
        scheduledDateKey,
        timeZone,
      });
    }

    const status = result.resumed ? 200 : 201;
    const response = { ...result };
    if (response?.workoutSession && response.workoutSession.workoutDayOccurrence == null) {
      const sessionObj = response.workoutSession.toObject
        ? response.workoutSession.toObject()
        : response.workoutSession;
      delete sessionObj.workoutDayOccurrence;
      response.workoutSession = sessionObj;
    }
    return res.status(status).json(response);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
};

/**
 * POST /api/workout-sessions/:sessionId/complete
 * Optional body: { totalDurationMinutes, strenuousnessRating, energyLevelRating }
 *
 * Completion guard: computes final progress and returns it alongside the
 * completed session. Currently relaxed (always allows completion); set
 * MIN_COMPLETION_PERCENT higher once frontend fully sends set data.
 */
const MIN_COMPLETION_PERCENT = 0;

export const complete = async (req, res, next) => {
  try {
    const progress = await computeSessionProgress(req.params.sessionId);

    if (MIN_COMPLETION_PERCENT > 0 && progress.percent < MIN_COMPLETION_PERCENT) {
      return res.status(422).json({
        message: `Complete at least ${MIN_COMPLETION_PERCENT}% of prescribed sets before finishing.`,
        progress,
      });
    }

    const isCalendar = await isCalendarSession(req.params.sessionId, req.user._id);

    const session = isCalendar
      ? await completeCalendarWorkoutSession(req.user._id, req.params.sessionId, req.body)
      : await completeWorkoutSession(req.user._id, req.params.sessionId, req.body);

    return res.status(200).json({
      message: "Workout completed.",
      workoutSession: session,
      progress,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
};

/**
 * POST /api/workout-sessions/check-missed
 */
export const checkMissed = async (req, res, next) => {
  try {
    const occResult = await markMissedPastDueForUser(req.user._id);
    const calResult = await markMissedCalendarDaysForUser(req.user._id);
    return res.status(200).json({
      message: "Missed check applied.",
      occurrenceUpdated: occResult.updated,
      calendarDaysUpdated: calResult.updated,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/workout-sessions/:sessionId
 * Full session detail with exercises, set logs, and progress summary.
 */
export const getDetail = async (req, res, next) => {
  try {
    const result = await getSessionDetail(req.user._id, req.params.sessionId);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
};

/**
 * PUT /api/workout-sessions/:sessionId/exercises/:sessionExerciseId/sets/:setNumber
 * Upsert a single set log (strength: reps/weight, cardio: duration/speed/incline).
 */
export const upsertSet = async (req, res, next) => {
  try {
    const { sessionExerciseId, setNumber } = req.params;
    const num = Number(setNumber);
    if (!Number.isInteger(num) || num < 1) {
      return res.status(400).json({ message: "setNumber must be a positive integer." });
    }

    const log = await upsertSetLog(req.user._id, sessionExerciseId, num, req.body);
    const progress = await computeSessionProgress(req.params.sessionId);

    return res.status(200).json({ setLog: log, progress });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
};

/**
 * POST /api/workout-sessions/:sessionId/sets/batch
 * Body: { sets: [{ sessionExerciseId, setNumber, recordedReps?, recordedWeight?, ... }] }
 */
export const batchUpsertSets = async (req, res, next) => {
  try {
    const { sets } = req.body || {};
    if (!Array.isArray(sets) || sets.length === 0) {
      return res.status(400).json({ message: "sets (non-empty array) is required." });
    }

    const logs = await batchUpsertSetLogs(req.user._id, req.params.sessionId, sets);
    const progress = await computeSessionProgress(req.params.sessionId);

    return res.status(200).json({ setLogs: logs, progress });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
};

/**
 * GET /api/workout-sessions/:sessionId/progress
 * Lightweight progress-only endpoint for chip updates.
 */
export const getProgress = async (req, res, next) => {
  try {
    const { default: WorkoutSession } = await import("../models/WorkoutSession.js");
    const session = await WorkoutSession.findOne({
      _id: req.params.sessionId,
      user: req.user._id,
    }).select("_id");
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }

    const progress = await computeSessionProgress(req.params.sessionId);
    return res.status(200).json(progress);
  } catch (err) {
    next(err);
  }
};

async function isCalendarWorkoutDay(workoutDayId) {
  const day = await WorkoutDay.findById(workoutDayId).select('workoutPlan scheduledDateKey');
  if (!day) return false;
  const plan = await WorkoutPlan.findById(day.workoutPlan).select('planShape');
  return plan?.planShape === 'calendar';
}

async function isCalendarSession(sessionId, userId) {
  const { default: WorkoutSession } = await import('../models/WorkoutSession.js');
  const session = await WorkoutSession.findOne({ _id: sessionId, user: userId }).select('workoutPlan');
  if (!session) return false;
  const plan = await WorkoutPlan.findById(session.workoutPlan).select('planShape');
  return plan?.planShape === 'calendar';
}
