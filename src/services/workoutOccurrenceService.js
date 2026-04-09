import { toDate } from 'date-fns-tz';
import WorkoutPlan from '../models/WorkoutPlan.js';
import WorkoutDay from '../models/WorkoutDay.js';
import WorkoutDayOccurrence from '../models/WorkoutDayOccurrence.js';
import WorkoutDayReplacement from '../models/WorkoutDayReplacement.js';
import WorkoutSession from '../models/WorkoutSession.js';
import User from '../models/User.js';
import { bootstrapSessionExercises } from './workoutTrackingService.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(s) {
  return typeof s === 'string' && DATE_KEY_RE.test(s);
}

/**
 * Instant when a slot becomes "missed" if still not completed:
 * end of user's local assigned calendar day (no grace period).
 */
export function computeMissedAfterUtc(scheduledDateKey, timeZone) {
  const endOfLocalDay = toDate(`${scheduledDateKey}T23:59:59.999`, { timeZone });
  if (Number.isNaN(endOfLocalDay.getTime())) {
    throw Object.assign(new Error('Invalid scheduledDateKey or timeZone for missed cutoff.'), {
      status: 400,
    });
  }
  return endOfLocalDay;
}

async function getActivePlanForUser(userId) {
  return WorkoutPlan.findOne({ user: userId, status: 'active' })
    .sort({ generatedAt: -1 })
    .select('_id');
}

export async function assertWorkoutDayOnActivePlan(workoutDayId, userId) {
  const plan = await getActivePlanForUser(userId);
  if (!plan) {
    throw Object.assign(new Error('No active workout plan found.'), { status: 404 });
  }
  const day = await WorkoutDay.findOne({
    _id: workoutDayId,
    workoutPlan: plan._id,
  }).select('_id');
  if (!day) {
    throw Object.assign(new Error('Workout day not found on your active plan.'), { status: 404 });
  }
  return { plan };
}

/**
 * Mirror template WorkoutDay row (current week UX). Reset weekly via resetTemplateStatuses.
 */
export async function syncWorkoutDayTemplateStatus(workoutDayId, status) {
  await WorkoutDay.updateOne({ _id: workoutDayId }, { $set: { status } });
}

/**
 * Ensure one occurrence per slot; leaves existing status untouched except updates timeZone/missedAfter if planned.
 */
export async function ensureOccurrences(userId, slots) {
  const plan = await getActivePlanForUser(userId);
  if (!plan) {
    throw Object.assign(new Error('No active workout plan found.'), { status: 404 });
  }

  const results = [];

  for (const slot of slots) {
    const { workoutDayId, scheduledDateKey, timeZone } = slot;
    if (!workoutDayId) {
      throw Object.assign(new Error('Each slot needs workoutDayId.'), { status: 400 });
    }
    if (!isValidDateKey(scheduledDateKey)) {
      throw Object.assign(new Error('Each slot needs scheduledDateKey YYYY-MM-DD.'), {
        status: 400,
      });
    }
    if (!timeZone || typeof timeZone !== 'string' || timeZone.length < 2) {
      throw Object.assign(new Error('Each slot needs a valid IANA timeZone.'), { status: 400 });
    }

    const onPlan = await WorkoutDay.findOne({
      _id: workoutDayId,
      workoutPlan: plan._id,
    }).select('_id');
    if (!onPlan) {
      throw Object.assign(new Error('Workout day not found on your active plan.'), { status: 404 });
    }

    const missedAfterUtc = computeMissedAfterUtc(scheduledDateKey, timeZone);

    let occ = await WorkoutDayOccurrence.findOne({
      user: userId,
      workoutPlan: plan._id,
      workoutDay: workoutDayId,
      scheduledDateKey,
    });

    if (!occ) {
      occ = await WorkoutDayOccurrence.create({
        user: userId,
        workoutPlan: plan._id,
        workoutDay: workoutDayId,
        scheduledDateKey,
        timeZone,
        missedAfterUtc,
        status: 'planned',
      });
    } else if (occ.status === 'planned' && !occ.activeSession) {
      occ.timeZone = timeZone;
      occ.missedAfterUtc = missedAfterUtc;
      await occ.save();
    }

    results.push(occ.toObject ? occ.toObject() : occ);
  }

  return results;
}

/**
 * Mark past-due occurrences missed; discard abandoned in_progress sessions.
 */
export async function markMissedPastDueForUser(userId) {
  const now = new Date();
  const filter = {
    user: userId,
    status: { $in: ['planned', 'in_progress'] },
    missedAfterUtc: { $lte: now },
  };

  const occs = await WorkoutDayOccurrence.find(filter);
  for (const occ of occs) {
    if (occ.activeSession) {
      await WorkoutSession.findByIdAndUpdate(occ.activeSession, {
        $set: { status: 'discarded' },
      });
    }
    occ.status = 'missed';
    occ.activeSession = null;
    await occ.save();
    await syncWorkoutDayTemplateStatus(occ.workoutDay, 'missed');
  }

  return { updated: occs.length };
}

export async function markMissedPastDueForAllUsers() {
  const now = new Date();
  const userIds = await WorkoutDayOccurrence.distinct('user', {
    status: { $in: ['planned', 'in_progress'] },
    missedAfterUtc: { $lte: now },
  });

  let total = 0;
  for (const uid of userIds) {
    const r = await markMissedPastDueForUser(uid);
    total += r.updated;
  }
  return { users: userIds.length, occurrencesUpdated: total };
}

export async function resetTemplateStatusesForActivePlan(userId) {
  const plan = await getActivePlanForUser(userId);
  if (!plan) {
    throw Object.assign(new Error('No active workout plan found.'), { status: 404 });
  }
  const res = await WorkoutDay.updateMany(
    { workoutPlan: plan._id },
    { $set: { status: 'planned' } },
  );
  return { modifiedCount: res.modifiedCount };
}

export async function listOccurrencesInRange(userId, startDateKey, endDateKey) {
  if (!isValidDateKey(startDateKey) || !isValidDateKey(endDateKey)) {
    throw Object.assign(new Error('startDate and endDate must be YYYY-MM-DD.'), { status: 400 });
  }

  const plan = await getActivePlanForUser(userId);
  if (!plan) {
    throw Object.assign(new Error('No active workout plan found.'), { status: 404 });
  }

  const occurrences = await WorkoutDayOccurrence.find({
    user: userId,
    workoutPlan: plan._id,
    scheduledDateKey: { $gte: startDateKey, $lte: endDateKey },
  })
    .sort({ scheduledDateKey: 1 })
    .lean();

  return occurrences;
}

export async function startWorkoutSession(userId, { workoutDayId, scheduledDateKey, timeZone }) {
  if (!isValidDateKey(scheduledDateKey)) {
    throw Object.assign(new Error('scheduledDateKey must be YYYY-MM-DD.'), { status: 400 });
  }
  if (!timeZone || typeof timeZone !== 'string') {
    throw Object.assign(new Error('timeZone (IANA) is required.'), { status: 400 });
  }

  await markMissedPastDueForUser(userId);

  const { plan } = await assertWorkoutDayOnActivePlan(workoutDayId, userId);
  const missedAfterUtc = computeMissedAfterUtc(scheduledDateKey, timeZone);

  let occ = await WorkoutDayOccurrence.findOne({
    user: userId,
    workoutPlan: plan._id,
    workoutDay: workoutDayId,
    scheduledDateKey,
  });

  if (!occ) {
    occ = await WorkoutDayOccurrence.create({
      user: userId,
      workoutPlan: plan._id,
      workoutDay: workoutDayId,
      scheduledDateKey,
      timeZone,
      missedAfterUtc,
      status: 'planned',
    });
  } else {
    occ.timeZone = timeZone;
    occ.missedAfterUtc = missedAfterUtc;
    await occ.save();
  }

  if (occ.status === 'completed') {
    throw Object.assign(new Error('This workout is already completed for that date.'), {
      status: 409,
    });
  }
  if (occ.status === 'missed') {
    throw Object.assign(new Error('This workout was marked missed for that date.'), {
      status: 409,
    });
  }

  if (occ.status === 'in_progress' && occ.activeSession) {
    const existing = await WorkoutSession.findOne({
      _id: occ.activeSession,
      user: userId,
      status: 'in_progress',
    });
    if (existing) {
      return { workoutSession: existing, workoutDayOccurrence: occ, resumed: true };
    }
  }

  const session = await WorkoutSession.create({
    user: userId,
    workoutDay: workoutDayId,
    workoutPlan: plan._id,
    workoutDayOccurrence: occ._id,
    scheduledDateKey,
    timeZone,
    status: 'in_progress',
    startedAt: new Date(),
  });

  await bootstrapSessionExercises(session._id, workoutDayId);

  occ.status = 'in_progress';
  occ.activeSession = session._id;
  await occ.save();

  return { workoutSession: session, workoutDayOccurrence: occ, resumed: false };
}

export async function completeWorkoutSession(userId, sessionId, body = {}) {
  await markMissedPastDueForUser(userId);

  const session = await WorkoutSession.findOne({
    _id: sessionId,
    user: userId,
  });

  if (!session) {
    throw Object.assign(new Error('Workout session not found.'), { status: 404 });
  }
  if (session.status !== 'in_progress') {
    throw Object.assign(new Error('Session is not in progress.'), { status: 409 });
  }

  const updates = {
    status: 'completed',
    completedAt: new Date(),
  };
  if (body.totalDurationMinutes != null) {
    updates.totalDurationMinutes = body.totalDurationMinutes;
  }
  if (body.strenuousnessRating != null) {
    updates.strenuousnessRating = body.strenuousnessRating;
  }
  if (body.energyLevelRating != null) {
    updates.energyLevelRating = body.energyLevelRating;
  }

  Object.assign(session, updates);
  await session.save();

  if (session.workoutDayOccurrence) {
    const occ = await WorkoutDayOccurrence.findById(session.workoutDayOccurrence);
    if (occ && String(occ.user) === String(userId)) {
      occ.status = 'completed';
      occ.activeSession = null;
      await occ.save();
    }
  }

  await syncWorkoutDayTemplateStatus(session.workoutDay, 'completed');

  return session;
}

// ---------------------------------------------------------------------------
// Calendar-plan missed logic (operates on WorkoutDay directly)
// ---------------------------------------------------------------------------

export async function markMissedCalendarDaysForUser(userId) {
  const now = new Date();
  const updated = await WorkoutDay.updateMany(
    {
      workoutPlan: { $in: await calendarPlanIdsForUser(userId) },
      isRestDay: false,
      status: { $in: ['planned', 'in_progress'] },
      missedAfterUtc: { $ne: null, $lte: now },
    },
    { $set: { status: 'missed', activeSession: null } },
  );

  if (updated.modifiedCount > 0) {
    const missedDays = await WorkoutDay.find({
      workoutPlan: { $in: await calendarPlanIdsForUser(userId) },
      status: 'missed',
      activeSession: { $ne: null },
    }).select('activeSession');

    for (const d of missedDays) {
      if (d.activeSession) {
        await WorkoutSession.findByIdAndUpdate(d.activeSession, {
          $set: { status: 'discarded' },
        });
        d.activeSession = null;
        await d.save();
      }
    }
  }

  return { updated: updated.modifiedCount };
}

async function calendarPlanIdsForUser(userId) {
  const plans = await WorkoutPlan.find({
    user: userId,
    status: 'active',
    planShape: 'calendar',
  }).select('_id');
  return plans.map((p) => p._id);
}

export async function markMissedCalendarDaysForAllUsers() {
  const now = new Date();
  const dayDocs = await WorkoutDay.find({
    isRestDay: false,
    status: { $in: ['planned', 'in_progress'] },
    missedAfterUtc: { $ne: null, $lte: now },
    scheduledDateKey: { $ne: null },
  }).select('workoutPlan');

  const planIds = [...new Set(dayDocs.map((d) => d.workoutPlan.toString()))];
  if (planIds.length === 0) return { users: 0, daysUpdated: 0 };

  const plans = await WorkoutPlan.find({
    _id: { $in: planIds },
    planShape: 'calendar',
  }).select('user');

  const userIds = [...new Set(plans.map((p) => p.user.toString()))];
  let totalUpdated = 0;
  for (const uid of userIds) {
    const r = await markMissedCalendarDaysForUser(uid);
    totalUpdated += r.updated;
  }
  return { users: userIds.length, daysUpdated: totalUpdated };
}

// ---------------------------------------------------------------------------
// Calendar-plan session start / complete
// ---------------------------------------------------------------------------

export async function startCalendarWorkoutSession(userId, { workoutDayId, timeZone }) {
  await markMissedCalendarDaysForUser(userId);

  const day = await WorkoutDay.findOne({ _id: workoutDayId });
  if (!day || !day.scheduledDateKey) {
    throw Object.assign(new Error('Calendar workout day not found.'), { status: 404 });
  }

  const plan = await WorkoutPlan.findOne({
    _id: day.workoutPlan,
    user: userId,
    status: 'active',
    planShape: 'calendar',
  });
  if (!plan) {
    throw Object.assign(new Error('Workout day not on your active calendar plan.'), { status: 404 });
  }

  const replacement = await WorkoutDayReplacement.findOne({
    user: userId,
    workoutPlan: plan._id,
    originalWorkoutDay: day._id,
  }).lean();

  const exerciseSourceDayId = replacement
    ? replacement.replacementWorkoutDay
    : day._id;

  if (day.isRestDay && !replacement) {
    throw Object.assign(new Error('Choose a workout before starting on a rest day.'), { status: 400 });
  }

  if (day.status === 'completed') {
    throw Object.assign(new Error('This workout is already completed.'), { status: 409 });
  }
  if (day.status === 'missed') {
    throw Object.assign(new Error('This workout was marked missed.'), { status: 409 });
  }

  if (day.status === 'in_progress' && day.activeSession) {
    const existing = await WorkoutSession.findOne({
      _id: day.activeSession,
      user: userId,
      status: 'in_progress',
    });
    if (existing) {
      return { workoutSession: existing, workoutDay: day.toObject(), resumed: true };
    }
  }

  if (timeZone && day.timeZone !== timeZone) {
    day.timeZone = timeZone;
    day.missedAfterUtc = computeMissedAfterUtc(day.scheduledDateKey, timeZone);
  }

  const session = await WorkoutSession.create({
    user: userId,
    workoutDay: day._id,
    workoutPlan: plan._id,
    scheduledDateKey: day.scheduledDateKey,
    timeZone: day.timeZone,
    status: 'in_progress',
    startedAt: new Date(),
  });

  await bootstrapSessionExercises(session._id, exerciseSourceDayId);

  day.status = 'in_progress';
  day.activeSession = session._id;
  await day.save();

  return { workoutSession: session, workoutDay: day.toObject(), resumed: false };
}

export async function completeCalendarWorkoutSession(userId, sessionId, body = {}) {
  await markMissedCalendarDaysForUser(userId);

  const session = await WorkoutSession.findOne({ _id: sessionId, user: userId });
  if (!session) {
    throw Object.assign(new Error('Workout session not found.'), { status: 404 });
  }
  if (session.status !== 'in_progress') {
    throw Object.assign(new Error('Session is not in progress.'), { status: 409 });
  }

  const updates = { status: 'completed', completedAt: new Date() };
  if (body.totalDurationMinutes != null) updates.totalDurationMinutes = body.totalDurationMinutes;
  if (body.strenuousnessRating != null) updates.strenuousnessRating = body.strenuousnessRating;
  if (body.energyLevelRating != null) updates.energyLevelRating = body.energyLevelRating;

  Object.assign(session, updates);
  await session.save();

  const day = await WorkoutDay.findById(session.workoutDay);
  if (day && String(day.workoutPlan) === String(session.workoutPlan)) {
    day.status = 'completed';
    day.activeSession = null;
    await day.save();
  }

  return session;
}
