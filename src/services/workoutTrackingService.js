/**
 * Granular per-exercise / per-set tracking during an active workout session.
 *
 * Responsibilities:
 *   1. Bootstrap WorkoutSessionExercise rows when a session starts.
 *   2. Upsert individual set logs (strength, bodyweight, cardio).
 *   3. Batch-upsert set logs for offline-sync bursts.
 *   4. Compute live progress summary (for chips / progress bar).
 *   5. Fetch full session detail with exercises + set logs.
 */

import WorkoutSession from '../models/WorkoutSession.js';
import WorkoutSessionExercise from '../models/WorkoutSessionExercise.js';
import WorkoutSetLog from '../models/WorkoutSetLog.js';
import WorkoutDayExercise from '../models/WorkoutDayExercise.js';

// ---------------------------------------------------------------------------
// 1. Bootstrap session exercises from the planned day
// ---------------------------------------------------------------------------

export async function bootstrapSessionExercises(sessionId, workoutDayId) {
  const existing = await WorkoutSessionExercise.countDocuments({ workoutSession: sessionId });
  if (existing > 0) return;

  const planned = await WorkoutDayExercise.find({ workoutDay: workoutDayId })
    .sort({ orderInDay: 1 })
    .lean();

  if (planned.length === 0) return;

  const docs = planned.map((de) => ({
    workoutSession: sessionId,
    workoutDayExercise: de._id,
    orderInSession: de.orderInDay,
  }));

  await WorkoutSessionExercise.insertMany(docs, { ordered: false }).catch((err) => {
    if (err.code !== 11000) throw err;
  });
}

// ---------------------------------------------------------------------------
// 2. Upsert a single set log
// ---------------------------------------------------------------------------

export async function upsertSetLog(userId, sessionExerciseId, setNumber, payload) {
  const se = await WorkoutSessionExercise.findById(sessionExerciseId)
    .populate([
      { path: 'workoutSession', select: 'user status' },
      {
        path: 'workoutDayExercise',
        select: 'exercise',
        populate: { path: 'exercise', select: 'exerciseType' },
      },
    ]);

  if (!se) {
    throw Object.assign(new Error('Session exercise not found.'), { status: 404 });
  }
  if (String(se.workoutSession.user) !== String(userId)) {
    throw Object.assign(new Error('Not your session.'), { status: 403 });
  }
  if (se.workoutSession.status !== 'in_progress') {
    throw Object.assign(new Error('Session is not in progress.'), { status: 409 });
  }

  const exerciseType = se.workoutDayExercise?.exercise?.exerciseType || 'strength';
  validatePayloadByExerciseType(payload, exerciseType);

  const update = { loggedAt: new Date() };
  if (payload.recordedReps != null) update.recordedReps = payload.recordedReps;
  if (payload.recordedWeight != null) update.recordedWeight = payload.recordedWeight;
  if (payload.weightUnit) update.weightUnit = payload.weightUnit;
  if (payload.recordedDurationMinutes != null) update.recordedDurationMinutes = payload.recordedDurationMinutes;
  if (payload.recordedSpeed != null) update.recordedSpeed = payload.recordedSpeed;
  if (payload.recordedIncline != null) update.recordedIncline = payload.recordedIncline;
  if (payload.isCompleted != null) update.isCompleted = payload.isCompleted;

  const log = await WorkoutSetLog.findOneAndUpdate(
    { workoutSessionExercise: sessionExerciseId, setNumber },
    { $set: update, $setOnInsert: { workoutSessionExercise: sessionExerciseId, setNumber } },
    { upsert: true, new: true, runValidators: true },
  );

  return log;
}

function validatePayloadByExerciseType(payload, exerciseType) {
  if (exerciseType === 'bodyweight') {
    if (payload.recordedWeight != null || payload.weightUnit != null) {
      throw Object.assign(
        new Error('Bodyweight exercises support reps only. Do not send weight fields.'),
        { status: 400 },
      );
    }
    if (
      payload.recordedDurationMinutes != null
      || payload.recordedSpeed != null
      || payload.recordedIncline != null
    ) {
      throw Object.assign(
        new Error('Bodyweight exercises do not support cardio metrics.'),
        { status: 400 },
      );
    }
    return;
  }

  if (exerciseType === 'cardio') {
    if (payload.recordedReps != null || payload.recordedWeight != null || payload.weightUnit != null) {
      throw Object.assign(
        new Error('Cardio exercises support duration/speed/incline only. Do not send reps/weight fields.'),
        { status: 400 },
      );
    }
    return;
  }

  if (payload.recordedDurationMinutes != null || payload.recordedSpeed != null || payload.recordedIncline != null) {
    throw Object.assign(
      new Error('Strength exercises do not support cardio metrics.'),
      { status: 400 },
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Batch upsert set logs
// ---------------------------------------------------------------------------

export async function batchUpsertSetLogs(userId, sessionId, entries) {
  const session = await WorkoutSession.findOne({ _id: sessionId, user: userId }).select('status');
  if (!session) {
    throw Object.assign(new Error('Session not found.'), { status: 404 });
  }
  if (session.status !== 'in_progress') {
    throw Object.assign(new Error('Session is not in progress.'), { status: 409 });
  }

  const seIds = [...new Set(entries.map((e) => e.sessionExerciseId))];
  const sessionExercises = await WorkoutSessionExercise.find({
    _id: { $in: seIds },
    workoutSession: sessionId,
  }).select('_id');
  const validSeIds = new Set(sessionExercises.map((se) => se._id.toString()));

  const results = [];
  for (const entry of entries) {
    if (!validSeIds.has(entry.sessionExerciseId)) continue;
    const log = await upsertSetLog(userId, entry.sessionExerciseId, entry.setNumber, entry);
    results.push(log);
  }

  return results;
}

// ---------------------------------------------------------------------------
// 4. Progress summary
// ---------------------------------------------------------------------------

export async function computeSessionProgress(sessionId) {
  const sessionExercises = await WorkoutSessionExercise.find({ workoutSession: sessionId })
    .populate({ path: 'workoutDayExercise', select: 'prescribedSets exercise', populate: { path: 'exercise', select: 'exerciseType' } })
    .sort({ orderInSession: 1 })
    .lean();

  const seIds = sessionExercises.map((se) => se._id);
  const allLogs = await WorkoutSetLog.find({ workoutSessionExercise: { $in: seIds } }).lean();

  const logsByExercise = {};
  for (const log of allLogs) {
    const key = log.workoutSessionExercise.toString();
    if (!logsByExercise[key]) logsByExercise[key] = [];
    logsByExercise[key].push(log);
  }

  let totalPrescribedSets = 0;
  let completedSets = 0;
  let completedExercises = 0;
  const totalExercises = sessionExercises.length;

  const exerciseProgress = sessionExercises.map((se) => {
    const prescribed = se.workoutDayExercise?.prescribedSets || 0;
    const exerciseType = se.workoutDayExercise?.exercise?.exerciseType || 'strength';
    const isCardio = exerciseType === 'cardio';
    const logs = logsByExercise[se._id.toString()] || [];
    const completedCount = logs.filter((l) => l.isCompleted).length;

    totalPrescribedSets += isCardio ? 1 : prescribed;
    completedSets += completedCount;

    const exerciseDone = isCardio
      ? completedCount >= 1
      : prescribed > 0 && completedCount >= prescribed;

    if (exerciseDone) completedExercises++;

    return {
      sessionExerciseId: se._id,
      orderInSession: se.orderInSession,
      exerciseType,
      prescribedSets: isCardio ? 1 : prescribed,
      completedSets: completedCount,
      done: exerciseDone,
    };
  });

  const percent = totalPrescribedSets > 0
    ? Math.round((completedSets / totalPrescribedSets) * 100)
    : 0;

  return {
    totalExercises,
    completedExercises,
    totalPrescribedSets,
    completedSets,
    percent,
    exercises: exerciseProgress,
  };
}

// ---------------------------------------------------------------------------
// 5. Full session detail
// ---------------------------------------------------------------------------

export async function getSessionDetail(userId, sessionId) {
  const session = await WorkoutSession.findOne({ _id: sessionId, user: userId }).lean();
  if (!session) {
    throw Object.assign(new Error('Session not found.'), { status: 404 });
  }

  const sessionExercises = await WorkoutSessionExercise.find({ workoutSession: sessionId })
    .populate({
      path: 'workoutDayExercise',
      select: 'exercise prescribedSets prescribedRepMin prescribedRepMax prescribedRestSeconds prescribedDurationMinutes prescribedSpeed prescribedIncline specialInstructions setType orderInDay',
      populate: {
        path: 'exercise',
        select: 'name description exerciseType muscleGroups equipment difficultyLevel videoUrl thumbnailUrl defaultSets defaultRepMin defaultRepMax defaultRestSeconds defaultDurationMinutes defaultSpeed defaultIncline',
      },
    })
    .sort({ orderInSession: 1 })
    .lean();

  const seIds = sessionExercises.map((se) => se._id);
  const allLogs = await WorkoutSetLog.find({ workoutSessionExercise: { $in: seIds } })
    .sort({ setNumber: 1 })
    .lean();

  const logsByExercise = {};
  for (const log of allLogs) {
    const key = log.workoutSessionExercise.toString();
    if (!logsByExercise[key]) logsByExercise[key] = [];
    logsByExercise[key].push(log);
  }

  const exercises = sessionExercises.map((se) => ({
    ...se,
    workoutDayExercise: se.workoutDayExercise
      ? {
          ...se.workoutDayExercise,
          category: se.workoutDayExercise.setType || "main",
        }
      : se.workoutDayExercise,
    setLogs: logsByExercise[se._id.toString()] || [],
  }));

  const progress = await computeSessionProgress(sessionId);

  return { session, exercises, progress };
}
