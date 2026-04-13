import { toDate } from "date-fns-tz";
import WorkoutPlan from "../models/WorkoutPlan.js";
import WorkoutDay from "../models/WorkoutDay.js";
import WorkoutDayExercise from "../models/WorkoutDayExercise.js";
import WorkoutDayOccurrence from "../models/WorkoutDayOccurrence.js";
import WorkoutDayReplacement from "../models/WorkoutDayReplacement.js";
import WorkoutSession from "../models/WorkoutSession.js";
import WorkoutSessionExercise from "../models/WorkoutSessionExercise.js";
import WorkoutSetLog from "../models/WorkoutSetLog.js";
import MealTracker from "../models/MealTracker.js";
import { markMissedPastDueForUser } from "./workoutOccurrenceService.js";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const DAY_LABELS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function dateKeyInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

export function dayLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return DAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function previousDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d));
  prev.setUTCDate(prev.getUTCDate() - 1);
  return prev.toISOString().slice(0, 10);
}

/** Mon–Sun keys for the ISO week containing dateKey. */
export function weekKeysForDate(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  const dow = ref.getUTCDay(); // 0=Sun
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() - ((dow + 6) % 7));

  const keys = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setUTCDate(monday.getUTCDate() + i);
    keys.push(cur.toISOString().slice(0, 10));
  }
  return keys;
}

/**
 * cardState values (8):
 *   today_planned | today_in_progress | today_completed | today_rest
 *   past_completed | past_missed | past_rest
 *   future
 */
export function computeCardState(dateKey, todayKey, occStatus) {
  const isToday = dateKey === todayKey;
  const isPast = dateKey < todayKey;

  if (occStatus === null || occStatus === undefined) {
    if (isToday) return "today_rest";
    if (isPast) return "past_rest";
    return "future";
  }

  if (isToday) {
    if (occStatus === "completed") return "today_completed";
    if (occStatus === "in_progress") return "today_in_progress";
    return "today_planned";
  }

  if (isPast) {
    if (occStatus === "completed") return "past_completed";
    if (occStatus === "missed") return "past_missed";
    return "past_rest";
  }

  return "future";
}

function timeOfDay(dateKey, timeZone) {
  try {
    const d = toDate(`${dateKey}T12:00:00`, { timeZone });
    const hour = d.getHours();
    if (hour < 12) return "morning";
    if (hour < 17) return "afternoon";
    if (hour < 21) return "evening";
    return "night";
  } catch {
    return "morning";
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getActivePlan(userId) {
  return WorkoutPlan.findOne({ user: userId, status: "active" })
    .sort({ generatedAt: -1 })
    .lean();
}

async function loadReplacementMap(userId, planId) {
  const rows = await WorkoutDayReplacement.find({
    user: userId,
    workoutPlan: planId,
  }).lean();

  const map = {};
  for (const r of rows) {
    map[String(r.originalWorkoutDay)] = String(r.replacementWorkoutDay);
  }
  return map;
}

/**
 * @param {import('mongoose').Types.ObjectId|string} sessionId
 * @returns {Promise<number|null>}
 */
async function setsCompletedPercentFromSessionId(sessionId) {
  const sessionExercises = await WorkoutSessionExercise.find({
    workoutSession: sessionId,
  })
    .select("_id workoutDayExercise")
    .lean();
  if (!sessionExercises.length) return null;

  const daeIds = sessionExercises
    .map((se) => se.workoutDayExercise)
    .filter(Boolean);
  const daeDocs = await WorkoutDayExercise.find({
    _id: { $in: daeIds },
  }).select("prescribedSets");
  const totalPrescribed = daeDocs.reduce(
    (s, d) => s + (d.prescribedSets || 0),
    0,
  );
  if (totalPrescribed === 0) return null;

  const seIds = sessionExercises.map((se) => se._id);
  const totalLogged = await WorkoutSetLog.countDocuments({
    workoutSessionExercise: { $in: seIds },
    isCompleted: true,
  });

  return Math.round((totalLogged / totalPrescribed) * 100);
}

async function setsCompletedPercent(occ) {
  if (occ.status !== "completed") return null;

  const session = await WorkoutSession.findOne({
    workoutDayOccurrence: occ._id,
    status: "completed",
  })
    .select("_id")
    .lean();
  if (!session) return null;

  return setsCompletedPercentFromSessionId(session._id);
}

/**
 * Calendar plans: completed session is keyed by workoutDay (calendar slot) + scheduledDateKey.
 *
 * @param {import('mongoose').Types.ObjectId|string} userId
 * @param {{ _id: unknown, scheduledDateKey?: string, status?: string }} day
 */
async function setsCompletedPercentForCalendarDay(userId, day) {
  if (!day || day.status !== "completed" || !day.scheduledDateKey) return null;

  const session = await WorkoutSession.findOne({
    user: userId,
    workoutDay: day._id,
    scheduledDateKey: day.scheduledDateKey,
    status: "completed",
  })
    .select("_id")
    .lean();
  if (!session) return null;

  return setsCompletedPercentFromSessionId(session._id);
}

async function computeStreak(userId, todayKey) {
  const allOccs = await WorkoutDayOccurrence.find({ user: userId })
    .sort({ scheduledDateKey: -1 })
    .select("scheduledDateKey status")
    .lean();

  const occMap = {};
  for (const occ of allOccs) occMap[occ.scheduledDateKey] = occ.status;

  let streak = 0;
  const [y, m, d] = todayKey.split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));

  for (let i = 0; i < 365; i++) {
    const key = cursor.toISOString().slice(0, 10);
    const status = occMap[key];

    if (status === "missed") break;
    if (status === "completed") streak++;

    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}

async function todayNutrition(userId, dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const endUtc = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));

  const meals = await MealTracker.find({
    user: userId,
    mealDateTime: { $gte: startUtc, $lte: endUtc },
  }).select(
    "calories protein carbs fats adjustedCalories adjustedProtein adjustedCarbs adjustedFats",
  );

  let totalCal = 0,
    totalP = 0,
    totalC = 0,
    totalF = 0;
  for (const m of meals) {
    totalCal += m.adjustedCalories ?? m.calories ?? 0;
    totalP += m.adjustedProtein ?? m.protein ?? 0;
    totalC += m.adjustedCarbs ?? m.carbs ?? 0;
    totalF += m.adjustedFats ?? m.fats ?? 0;
  }

  return {
    consumed: {
      calories: Math.round(totalCal),
      protein: Math.round(totalP),
      carbs: Math.round(totalC),
      fat: Math.round(totalF),
    },
    mealCount: meals.length,
  };
}

// ---------------------------------------------------------------------------
// Dashboard builder
// ---------------------------------------------------------------------------

export async function buildDashboard(userId, dateKey, timeZone) {
  const plan = await getActivePlan(userId);

  if (!plan) {
    return {
      hasPlan: false,
      streak: { current: 0 },
      weekSchedule: [],
      todayNutrition: await todayNutrition(userId, dateKey),
    };
  }

  const isCalendar = plan.planShape === "calendar";

  if (isCalendar) {
    const { markMissedCalendarDaysForUser } =
      await import("./workoutOccurrenceService.js");
    await markMissedCalendarDaysForUser(userId);
    return buildCalendarDashboard(userId, dateKey, timeZone, plan);
  }

  await markMissedPastDueForUser(userId);
  return buildTemplateDashboard(userId, dateKey, timeZone, plan);
}

async function buildCalendarDashboard(userId, dateKey, timeZone, plan) {
  const weekKeys = weekKeysForDate(dateKey);

  const weekDays = await WorkoutDay.find({
    workoutPlan: plan._id,
    scheduledDateKey: { $gte: weekKeys[0], $lte: weekKeys[6] },
  })
    .sort({ scheduledDateKey: 1 })
    .lean();

  const dayByDate = {};
  for (const d of weekDays) dayByDate[d.scheduledDateKey] = d;

  const replacementMap = await loadReplacementMap(userId, plan._id);
  const allDays = await WorkoutDay.find({
    workoutPlan: plan._id,
    isRestDay: false,
  })
    .select("_id name dayNumber iconIdentifier")
    .lean();
  const allDaysById = {};
  for (const d of allDays) allDaysById[String(d._id)] = d;
  const effectiveDayId = (dayId) =>
    replacementMap[String(dayId)] || String(dayId);

  const weekSchedule = await Promise.all(
    weekKeys.map(async (key) => {
      const day = dayByDate[key] ?? null;

      if (!day || day.isRestDay) {
        return {
          dateKey: key,
          dayLabel: dayLabel(key),
          cardState: computeCardState(key, dateKey, null),
          isRestDay: true,
          workoutDay: day,
          effectiveWorkoutDay: day,
          setsCompletedPercent: null,
        };
      }

      const effId = effectiveDayId(String(day._id));
      const effectiveDay = allDaysById[effId] || day;

      let setsPct = null;
      if (day.status === "completed") {
        setsPct = await setsCompletedPercentForCalendarDay(userId, day);
      }

      return {
        dateKey: key,
        dayLabel: dayLabel(key),
        cardState: computeCardState(key, dateKey, day.status),
        isRestDay: false,
        workoutDay: day,
        effectiveWorkoutDay: effectiveDay,
        setsCompletedPercent: setsPct,
      };
    }),
  );

  const streak = await computeCalendarStreak(userId, plan._id, dateKey);
  const nutrition = await todayNutrition(userId, dateKey);
  const todayCard = weekSchedule.find((s) => s.dateKey === dateKey) ?? null;

  return {
    hasPlan: true,
    plan: {
      _id: plan._id,
      name: plan.name,
      generationType: plan.generationType,
      planShape: plan.planShape,
    },
    streak: { current: streak },
    todayCard,
    weekSchedule,
    todayNutrition: nutrition,
    timeOfDay: timeOfDay(dateKey, timeZone),
  };
}

async function buildTemplateDashboard(userId, dateKey, timeZone, plan) {
  const allDays = await WorkoutDay.find({ workoutPlan: plan._id })
    .sort({ dayNumber: 1 })
    .lean();

  const replacementMap = await loadReplacementMap(userId, plan._id);

  const allDaysById = {};
  for (const day of allDays) allDaysById[String(day._id)] = day;

  const effectiveDayId = (dayId) =>
    replacementMap[String(dayId)] || String(dayId);

  const weekKeys = weekKeysForDate(dateKey);

  const weekOccs = await WorkoutDayOccurrence.find({
    user: userId,
    workoutPlan: plan._id,
    scheduledDateKey: { $gte: weekKeys[0], $lte: weekKeys[6] },
  }).lean();

  const occByDate = {};
  for (const occ of weekOccs) occByDate[occ.scheduledDateKey] = occ;

  const weekSchedule = await Promise.all(
    weekKeys.map(async (key) => {
      const occ = occByDate[key] ?? null;
      const cardState = computeCardState(key, dateKey, occ?.status ?? null);

      let workoutDay = null;
      let effectiveWorkoutDay = null;
      let setsPct = null;

      if (occ) {
        const orig = allDaysById[String(occ.workoutDay)];
        const effId = effectiveDayId(String(occ.workoutDay));
        const eff = allDaysById[effId] || orig;

        workoutDay = orig ?? null;
        effectiveWorkoutDay = eff ?? null;

        if (occ.status === "completed") {
          setsPct = await setsCompletedPercent(occ);
        }
      }

      return {
        dateKey: key,
        dayLabel: dayLabel(key),
        cardState,
        isRestDay: occ === null,
        occurrence: occ,
        workoutDay,
        effectiveWorkoutDay,
        setsCompletedPercent: setsPct,
      };
    }),
  );

  const streak = await computeStreak(userId, dateKey);
  const nutrition = await todayNutrition(userId, dateKey);
  const todayCard = weekSchedule.find((s) => s.dateKey === dateKey) ?? null;

  return {
    hasPlan: true,
    plan: {
      _id: plan._id,
      name: plan.name,
      generationType: plan.generationType,
      planShape: plan.planShape || "template",
    },
    streak: { current: streak },
    todayCard,
    weekSchedule,
    todayNutrition: nutrition,
    timeOfDay: timeOfDay(dateKey, timeZone),
  };
}

async function computeCalendarStreak(userId, planId, todayKey) {
  const allDays = await WorkoutDay.find({
    workoutPlan: planId,
    isRestDay: false,
    scheduledDateKey: { $lte: todayKey },
  })
    .sort({ scheduledDateKey: -1 })
    .select("scheduledDateKey status")
    .lean();

  let streak = 0;
  for (const d of allDays) {
    if (d.status === "missed") break;
    if (d.status === "completed") streak++;
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Replacement sheet options (yesterday-completed exclusion)
// ---------------------------------------------------------------------------

/**
 * Build the "Change Today's Workout" sheet data:
 * - all workout day templates from the active plan
 * - flag which one is blocked (yesterday's completed effective workout)
 *
 * @param {string|ObjectId} userId
 * @param {string} todayDateKey  YYYY-MM-DD
 * @returns {Promise<{ options: Array, blockedWorkoutDayId: string|null }>}
 */
export async function buildReplacementSheetOptions(userId, todayDateKey) {
  const plan = await getActivePlan(userId);
  if (!plan) {
    throw Object.assign(new Error("No active workout plan found."), {
      status: 404,
    });
  }

  const isCalendar = plan.planShape === "calendar";

  const allDays = await WorkoutDay.find({
    workoutPlan: plan._id,
    ...(isCalendar ? { isRestDay: false } : {}),
  })
    .sort({ dayNumber: 1 })
    .select("_id name dayNumber exerciseCount iconIdentifier")
    .lean();

  // Deduplicate by split name so each workout type appears once
  const seen = new Set();
  const uniqueDays = [];
  for (const day of allDays) {
    if (!seen.has(day.name)) {
      seen.add(day.name);
      uniqueDays.push(day);
    }
  }

  const replacementMap = await loadReplacementMap(userId, plan._id);
  const yesterdayKey = previousDateKey(todayDateKey);

  let blockedWorkoutDayId = null;
  let blockedName = null;

  if (isCalendar) {
    const yesterdayDay = await WorkoutDay.findOne({
      workoutPlan: plan._id,
      scheduledDateKey: yesterdayKey,
      status: "completed",
    }).lean();

    if (yesterdayDay) {
      const origId = String(yesterdayDay._id);
      const effectiveId = replacementMap[origId] || origId;
      blockedWorkoutDayId = effectiveId;
      const effectiveDay = allDays.find((d) => String(d._id) === effectiveId);
      blockedName = effectiveDay?.name ?? null;
    }
  } else {
    const yesterdayOcc = await WorkoutDayOccurrence.findOne({
      user: userId,
      workoutPlan: plan._id,
      scheduledDateKey: yesterdayKey,
      status: "completed",
    }).lean();

    if (yesterdayOcc) {
      const origId = String(yesterdayOcc.workoutDay);
      const effectiveId = replacementMap[origId] || origId;
      blockedWorkoutDayId = effectiveId;
      const effectiveDay = allDays.find((d) => String(d._id) === effectiveId);
      blockedName = effectiveDay?.name ?? null;
    }
  }

  // Look up today's day for UI metadata (title + Planned badge)
  let todayDay = null;
  if (isCalendar) {
    todayDay = await WorkoutDay.findOne({
      workoutPlan: plan._id,
      scheduledDateKey: todayDateKey,
    })
      .select("_id name isRestDay")
      .lean();
  }

  const todayIsRestDay = todayDay?.isRestDay ?? true;
  const todayEffectiveName = todayIsRestDay ? null : todayDay.name;

  const options = uniqueDays.map((day) => {
    const isTodaysScheduled =
      !todayIsRestDay && day.name === todayEffectiveName;
    // Cooldown: same split name as yesterday's completed effective workout — including
    // when that split is also today's calendar workout (picker shows disabled / "Yesterday" UX).
    const disabled = blockedName != null && day.name === blockedName;
    return {
      ...day,
      disabled,
      disabledReason: disabled ? "completed_yesterday" : null,
      isScheduledToday: isTodaysScheduled,
    };
  });

  return {
    options,
    blockedWorkoutDayId,
    isRestDay: todayIsRestDay,
    todayWorkoutDayId: todayDay?._id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Replacement CRUD helpers
// ---------------------------------------------------------------------------

async function assertDayOnPlan(dayId, planId) {
  const day = await WorkoutDay.findOne({
    _id: dayId,
    workoutPlan: planId,
  }).select("_id name");
  if (!day) {
    throw Object.assign(
      new Error("WorkoutDay not found on your active plan."),
      { status: 404 },
    );
  }
  return day;
}

export async function listReplacements(userId) {
  const plan = await getActivePlan(userId);
  if (!plan)
    throw Object.assign(new Error("No active workout plan."), { status: 404 });

  return WorkoutDayReplacement.find({ user: userId, workoutPlan: plan._id })
    .populate("originalWorkoutDay", "name dayNumber iconIdentifier")
    .populate("replacementWorkoutDay", "name dayNumber iconIdentifier")
    .lean();
}

export async function createReplacement(
  userId,
  { originalWorkoutDayId, replacementWorkoutDayId },
) {
  if (!originalWorkoutDayId || !replacementWorkoutDayId) {
    throw Object.assign(
      new Error(
        "originalWorkoutDayId and replacementWorkoutDayId are required.",
      ),
      { status: 400 },
    );
  }
  if (String(originalWorkoutDayId) === String(replacementWorkoutDayId)) {
    throw Object.assign(new Error("A workout day cannot replace itself."), {
      status: 400,
    });
  }

  const plan = await getActivePlan(userId);
  if (!plan)
    throw Object.assign(new Error("No active workout plan."), { status: 404 });

  await assertDayOnPlan(originalWorkoutDayId, plan._id);
  await assertDayOnPlan(replacementWorkoutDayId, plan._id);

  const replacementDay = await WorkoutDay.findById(
    replacementWorkoutDayId,
  ).select("isRestDay");
  if (replacementDay && replacementDay.isRestDay) {
    throw Object.assign(
      new Error("Cannot replace a workout with a rest day."),
      { status: 400 },
    );
  }

  const replacement = await WorkoutDayReplacement.findOneAndUpdate(
    {
      user: userId,
      workoutPlan: plan._id,
      originalWorkoutDay: originalWorkoutDayId,
    },
    {
      $set: {
        user: userId,
        workoutPlan: plan._id,
        originalWorkoutDay: originalWorkoutDayId,
        replacementWorkoutDay: replacementWorkoutDayId,
      },
    },
    { upsert: true, new: true },
  )
    .populate("originalWorkoutDay", "name dayNumber iconIdentifier")
    .populate("replacementWorkoutDay", "name dayNumber iconIdentifier");

  return replacement;
}

export async function deleteReplacement(userId, replacementId) {
  const plan = await getActivePlan(userId);
  if (!plan)
    throw Object.assign(new Error("No active workout plan."), { status: 404 });

  const deleted = await WorkoutDayReplacement.findOneAndDelete({
    _id: replacementId,
    user: userId,
    workoutPlan: plan._id,
  });

  if (!deleted) {
    throw Object.assign(new Error("Replacement not found."), { status: 404 });
  }

  return deleted;
}
