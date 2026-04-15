/**
 * Workout plan generation orchestrator (calendar-only, 3 weeks).
 *
 * Flow: load context -> catalog from Mongo -> rules from Mongo -> LLM -> validate -> persist.
 *
 * All plans are calendar-shaped: 21–30 days keyed by YYYY-MM-DD with explicit rest days.
 * dailyStepGoal is computed deterministically (no LLM tokens) and stored on the plan doc.
 */

import mongoose from "mongoose";
import { ensureMongoConnected } from "../config/database.js";
import openai, { CHAT_MODEL } from "../config/openai.js";
import { deriveCatalogKey } from "./catalogKey.js";
import { loadCatalogExercises } from "./catalogExercises.js";
import { computeMissedAfterUtc } from "./workoutOccurrenceService.js";
import BodyDetails from "../models/BodyDetails.js";
import TrainerRules from "../models/TrainerRules.js";
import WorkoutPlan from "../models/WorkoutPlan.js";
import WorkoutDay from "../models/WorkoutDay.js";
import WorkoutDayExercise from "../models/WorkoutDayExercise.js";
import User from "../models/User.js";

/** Minimum accepted schedule length; LLM prompts require exactly this many days. */
const MIN_PLAN_DAYS = 21;
const MAX_PLAN_DAYS = 30;
/** Alias for prompts and legacy strings (21-day calendar target). */
const PLAN_DAYS = MIN_PLAN_DAYS;

// ---------------------------------------------------------------------------
// Deterministic helpers (no LLM cost)
// ---------------------------------------------------------------------------

const STEP_GOAL_BY_GOAL = {
  lose_weight: 10_000,
  improve_endurance: 12_000,
  build_muscle: 7_000,
  gain_weight: 7_000,
  stress_relief: 8_000,
};

const ACTIVITY_LEVEL_DELTA = {
  very_active: 2_000,
  moderate: 1_000,
  light: 0,
  none: -1_000,
};

export function computeDailyStepGoal(user) {
  const goals = user.fitnessGoals || [];
  let base = 8_000;
  for (const g of goals) {
    if (STEP_GOAL_BY_GOAL[g] != null) {
      base = STEP_GOAL_BY_GOAL[g];
      break;
    }
  }
  const delta = ACTIVITY_LEVEL_DELTA[user.activityLevelApartFromWorkout] ?? 0;
  return Math.max(5_000, base + delta);
}

const CARDIO_BUDGET_BY_GOAL = {
  lose_weight: "2-3x/week, 15-30 min moderate intensity post-lift",
  improve_endurance: "3-4x/week, 20-40 min zone-2 steady-state",
  build_muscle: "at most 1x/week, keep it short (10-15 min)",
  gain_weight: "at most 1x/week, keep it short (10-15 min)",
  stress_relief: "1-2x/week, 15-20 min low-intensity",
};

function computeCardioBudget(fitnessGoals) {
  for (const g of fitnessGoals || []) {
    if (CARDIO_BUDGET_BY_GOAL[g]) return CARDIO_BUDGET_BY_GOAL[g];
  }
  return "1-2x/week, 15-20 min moderate intensity";
}

// ---------------------------------------------------------------------------
// System prompt — compact, 3-week calendar
// ---------------------------------------------------------------------------

const FALLBACK_RULES = `
General programming principles when no trainer-specific rules are available:

- Order: compound movements first, isolation second, cardio last.
- Hypertrophy rep target: 6-12 reps for strength, 12-20 for endurance/toning.
- Compounds: 3-5 sets, 90-180 s rest. Isolations: 2-4 sets, 60-90 s rest.
- Cardio: prescribedSets=1; duration and intensity per CARDIO_BUDGET; specialInstructions must describe zone/intensity (e.g. "Zone 2 - conversational pace").
- Apply progressive overload cues across 3 weeks as per programming rules.
- Include at least one unilateral movement per lower-body day to address imbalances.
- Beginners default to the lower bound of all set/rep/load ranges.
- focusAreas is a light preference, not the main program driver. Every plan must still train chest, back, legs (quads/hamstrings/glutes), shoulders (all three heads), arms, and core across the week for an aesthetic, balanced physique. Only after that baseline, add slightly more sets or a finisher for focusAreas without dropping any major region below a fair weekly minimum.
`.trim();

const CALENDAR_INSTRUCTIONS = `You are MyTrainr AI — an expert personal trainer. Your sole task is to output one JSON object: a workout plan whose "schedule" array has exactly ${MIN_PLAN_DAYS} days. No markdown, no explanation, no extra keys.

<schedule_length>
MANDATORY — non-negotiable:
- The "schedule" array MUST have exactly ${MIN_PLAN_DAYS} elements (${MIN_PLAN_DAYS} day objects). Not ${MIN_PLAN_DAYS - 1}, not ${MIN_PLAN_DAYS + 1}, not any other length.
- Those ${MIN_PLAN_DAYS} days are ${MIN_PLAN_DAYS} consecutive calendar days starting from the startDate in the user message (inclusive): one object per date, no gaps, no duplicate dateKey values.
- Before you finish, mentally count schedule.length === ${MIN_PLAN_DAYS}. If not, fix the output before responding.
</schedule_length>

<output_schema>
{
  "planName": "string - descriptive, e.g. 'Push-Pull-Legs Hypertrophy Cycle'",
  "schedule": [
    {
      "dateKey": "YYYY-MM-DD",
      "weekday": "mon|tue|wed|thu|fri|sat|sun",
      "isRestDay": false,
      "name": "Push Day - Chest & Triceps",
      "estimatedDurationMinutes": 60,
      "proTip": "One concrete, session-specific coaching cue",
      "exercises": [
        {
          "exerciseIndex": 0,
          "orderInDay": 1,
          "prescribedSets": 4,
          "prescribedRepMin": 8,
          "prescribedRepMax": 12,
          "prescribedRestSeconds": 90,
          "prescribedDurationMinutes": null,
          "prescribedSpeed": null,
          "prescribedIncline": null,
          "setType": "main",
          "specialInstructions": ""
        }
      ]
    },
    {
      "dateKey": "YYYY-MM-DD",
      "weekday": "sun",
      "isRestDay": true,
      "name": "Rest Day",
      "estimatedDurationMinutes": null,
      "proTip": "",
      "exercises": []
    }
  ]
}
</output_schema>

<exercise_indexing>
- exerciseIndex is a 0-based integer into the EXERCISES array in the user message.
- Valid range: 0 ... N-1. Never invent or guess an index outside this range.
- Each day's exercises must reference only indices present in that array.
</exercise_indexing>

<set_types>
Exactly one of: "warmup" | "main" | "cooldown" | "superset" | "dropset"
- warmup: sub-maximal load, prepares joint and nervous system
- main: primary working sets at prescribed load
- cooldown: low-intensity, end-of-session mobility or stretch
- superset: paired with the immediately following exercise; rest only after both
- dropset: reach near-failure, strip 20-30% load, continue without rest; note load cue in specialInstructions
</set_types>

<cardio_rules>
For any exercise where t="cardio":
  prescribedSets = 1 (always)
  prescribedRepMin = null
  prescribedRepMax = null
  prescribedDurationMinutes = integer, 10-60
  prescribedSpeed = number >= 0, or null
  prescribedIncline = number >= 0, or null
Place cardio at the END of the day unless the day is cardio-only.
Honour CARDIO_BUDGET exactly — do not add extra cardio sessions beyond it.
</cardio_rules>

<programming_rules>
BALANCED PHYSIQUE (non-negotiable, overrides focusAreas in priority)
The athlete is building an aesthetic, proportional physique. Every training week must deliver direct, meaningful work (not only indirect compounds) for ALL of the following across the scheduled sessions: chest; upper back/lats; legs (quads and hamstrings and glutes — not legs-only-quads); shoulders (anterior, lateral, and rear delts over the week); biceps and triceps; calves when equipment allows; core (abs/obliques or anti-extension work) at least twice per week on non-consecutive days.
- Do NOT let focusAreas shrink, replace, or crowd out any of these regions. If focusAreas mention one body part, that part may receive a modest extra 1–2 sets or a prioritized finisher — never at the expense of skipping another major region for the week.
- Choose splits (e.g. Push/Pull/Legs, Upper/Lower, or bro-split variants) that naturally hit every region each week given workoutDays. If training frequency is low (e.g. 2–3 days/week), use full-body or upper/lower so every major pattern appears every week.

SPLIT DESIGN
Design the split from workoutDays count + fitnessGoals first, with full-body balance as the hard constraint above. Good options by frequency:
  • 2–3 days/week → Full Body or Upper/Lower so every region appears each week.
  • 4 days/week → Upper/Lower or Push/Pull.
  • 5–6 days/week → Push/Pull/Legs or body-part split (e.g. Chest+Tri / Back+Bi / Shoulders / Legs); every region still appears at least once per week.
  • 7 days/week → body-part split with two active-recovery days; all regions covered weekly.
focusAreas must NOT determine the split; they only tweak volume emphasis inside an already balanced week.
Repeat the same split structure across all 3 weeks. Do not randomly reorder days.

FOCUS AREAS — accent only (after balanced baseline is satisfied)
focusAreas are optional preferences: add a small bias (extra set, better exercise order, or a targeted specialInstructions cue), not a second program.

- Default stance: treat focusAreas as roughly +10–20% direct volume on that muscle versus non-focus areas in the same tier (e.g. one more isolation set or one upgraded exercise choice), never double volume and never add extra dedicated days that drop other regions below the weekly minimum above.
- Large muscle groups (glutes, back, quads, chest): if in focusAreas, you may add one working set to a primary lift or one extra isolation; still ensure antagonist and other regions meet the balanced physique rules.
- Small muscle groups (biceps, triceps, rear delts, calves): cap extra focusArea work at +1–2 sets per week total for that muscle vs your balanced default, placed after compounds; keep reps in the 10–15 hypertrophy range.
- Antagonist balance stays mandatory: e.g. focusAreas = ["chest"] still requires full weekly back volume; focusAreas = ["biceps"] still requires triceps work in line with the balanced rules.
- Distribute any extra focusArea load across the week; respect ~48 h recovery before hammering the same muscle again.
- In specialInstructions for focusArea exercises only, you may note intent (e.g. "Focus area: squeeze peak on curls"); do not repeat focusArea language on every exercise.

PROGRESSIVE OVERLOAD - vary load cues across 3 weeks:
  Week 1 (days 1-7): Orientation. Sets at lower end of range. specialInstructions: "Focus on form and full ROM."
  Week 2 (days 8-14): Accumulation. Add 1 working set to primary compounds. specialInstructions: "Increase load 5% vs week 1 if form was solid."
  Week 3 (days 15-21): Intensification. Keep sets, push top-end of rep range or add load. specialInstructions: "Aim for 5-10% heavier than week 2 on main lifts."
Reflect the current week's theme in each day's proTip.

EXERCISE ORDERING:
  1. Warmup sets (if any)
  2. Compound movements (multi-joint, 3-5 sets, 90-180 s rest)
  3. Isolation movements (single-joint, 2-4 sets, 60-90 s rest)
  4. Cardio (if scheduled, per CARDIO_BUDGET)
  5. Cooldown (optional)

VOLUME:
  Exercises per session: see VOLUME SCALING BY TRAINING FREQUENCY below for frequency-specific caps. For 4 days/week or fewer, 5–8 exercises per session is standard.
  Weekly sets per muscle group: target roughly similar totals across major regions (chest, back, legs, shoulders) so no one line looks neglected — typically ~10–18 hard sets per week per large region for hypertrophy, adjusted for workoutDays. When training frequency is high (5–7 days), weekly totals stay in this band but are spread across more, shorter sessions. Arms and calves often land slightly lower but must still appear every week with direct work, not only as afterthoughts from compounds. Use focusAreas to nudge within this band, not to create 2× volume in one muscle and starvation in another.
  Beginners: favour lower set counts (3 sets) and longer rest (upper ends of rest ranges).

REST DAYS — strict classification (non-negotiable):
  • Every calendar day whose weekday matches a day listed in trainingDays MUST have isRestDay=false with at least one exercise. You may NEVER turn a selected training day into a rest day.
  • Every calendar day whose weekday is NOT listed in trainingDays MUST have isRestDay=true with exercises=[].
  • The user's trainingDays is the sole authority on which days are workout days. Do not add extra rest days for "recovery" beyond what the user's schedule already implies.
  Rest day format: isRestDay=true, exercises=[], estimatedDurationMinutes=null, proTip="", name="Rest Day".
  The full schedule is always exactly ${MIN_PLAN_DAYS} consecutive days from the given start date — see <schedule_length>.

VOLUME SCALING BY TRAINING FREQUENCY — adjust per-session volume so weekly totals stay appropriate for recovery and the user's fitnessGoals:
  • 4 days/week : 5–8 exercises/session, 3–4 sets each — standard baseline.
  • 5 days/week : 4–6 exercises/session, 3 sets each; shorten rest to 60–90 s.
  • 6 days/week : 3–5 exercises/session, 3 sets each; sessions 45–60 min; one session per week may be active recovery (light cardio or mobility, no heavy compounds).
  • 7 days/week : 3–4 exercises/session, 2–3 sets each; two sessions per week should be active recovery.
  Never exceed the per-session caps above when frequency is high. Per-session intensity cues and rep ranges must still reflect fitnessGoals (hypertrophy, fat loss, endurance, etc.).
</programming_rules>`;

function buildSystemPrompt(rulesContent) {
  return `${CALENDAR_INSTRUCTIONS}\n\n## TRAINER RULES\n${rulesContent}`;
}

// ---------------------------------------------------------------------------
// Build user prompt (compact exercise keys to save tokens)
// ---------------------------------------------------------------------------

function compactExerciseList(exercises) {
  return exercises.map((ex, idx) => ({
    i: idx,
    n: ex.name,
    t: ex.exerciseType,
    mg: ex.muscleGroups,
    eq: ex.equipment,
    dl: ex.difficultyLevel,
  }));
}

const ALL_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function buildUserPrompt(
  user,
  bodyDetails,
  exercises,
  todayDateKey,
  timeZone,
  cardioBudget,
) {
  const trainingDaySet = new Set((user.workoutDays || []).map((d) => d.toLowerCase()));
  const restDays = ALL_WEEKDAYS.filter((d) => !trainingDaySet.has(d));

  const profile = {
    fitnessGoals: user.fitnessGoals,
    fitnessLevel: user.fitnessLevel,
    workoutEnvironment: user.workoutEnvironment,
    weightliftingExperience: user.weightliftingExperience,
    workoutDays: user.workoutDays,
    focusAreas: user.focusAreas,
    gender: bodyDetails.gender,
    age: bodyDetails.age,
    weightKg: bodyDetails.weight,
    heightCm: bodyDetails.height,
  };

  const compact = compactExerciseList(exercises);

  return `<athlete_profile>
${JSON.stringify(profile)}
</athlete_profile>

<calendar>
startDate: ${todayDateKey}
timezone: ${timeZone}
totalDays: ${MIN_PLAN_DAYS}
trainingDaysPerWeek: ${user.workoutDays.length}
trainingDays: ${user.workoutDays.join(", ")}
restDays: ${restDays.length > 0 ? restDays.join(", ") : "none — all 7 days are training days"}

CRITICAL: Every day whose weekday appears in trainingDays above MUST be a workout day (isRestDay=false with exercises). Only the days in restDays above may have isRestDay=true. Do NOT add extra rest days for recovery — adjust per-session volume instead (see VOLUME SCALING BY TRAINING FREQUENCY in system instructions).
</calendar>

<cardio_budget>
${cardioBudget}
Do not schedule more cardio than this budget allows.
</cardio_budget>

<exercises count="${compact.length}">
Fields: i=exerciseIndex (use as exerciseIndex in output), n=name, t=exerciseType, mg=muscleGroups, eq=equipment, dl=difficultyLevel
${JSON.stringify(compact)}
</exercises>

Build a calendar plan starting ${todayDateKey} with exactly ${MIN_PLAN_DAYS} consecutive days in "schedule" (see <schedule_length> in system instructions — array length must be ${MIN_PLAN_DAYS}).
First satisfy BALANCED PHYSIQUE and SPLIT DESIGN in the system instructions (every major muscle region trained each week). Then, if focusAreas = [${(user.focusAreas || []).map((f) => `"${f}"`).join(", ") || '"none"'}], apply FOCUS AREAS as a small accent only — never replace or starve other body parts.
Choose the split from workoutDays + goals; use focusAreas only for minor volume or cue tweaks after the balanced baseline is met.
Cycle the split across all 3 weeks with progressive overload as instructed.
Select exercises that match workoutEnvironment="${user.workoutEnvironment}" and fitnessLevel="${user.fitnessLevel}".
FINAL CHECK: "schedule" must contain exactly ${MIN_PLAN_DAYS} objects, one per calendar day from ${todayDateKey} onward without skipping or duplicating dates. Verify that every trainingDay (${user.workoutDays.join(", ")}) maps to a workout day and every restDay (${restDays.length > 0 ? restDays.join(", ") : "none"}) maps to a rest day.`;
}

function buildPhotoRefinementSection(photoProfile) {
  const subset = {
    posture: photoProfile.posture,
    muscleBalance: photoProfile.muscleBalance,
    bodyComposition: photoProfile.bodyComposition,
    movementRiskFlags: photoProfile.movementRiskFlags,
    summary: photoProfile.summary,
    trainingRecommendations: photoProfile.trainingRecommendations,
  };

  return `

<body_photo_analysis>
${JSON.stringify(subset)}
</body_photo_analysis>

<photo_refinement_instructions>
You are now enhancing the plan above using real observations from the athlete's body photos.
Work through each priority tier in order. At each tier, determine whether action is needed before making changes.
If a tier has nothing to act on (e.g. movementRiskFlags is empty), skip it and move on — do not fabricate corrections.

━━━ PRIORITY 1 — MOVEMENT SAFETY (movementRiskFlags) ━━━
For every flag in movementRiskFlags:
  - Substitute or modify the exercise that stresses the flagged area.
  - In specialInstructions, start with "safety: " then name the original exercise and the reason (e.g. "safety: replaced barbell squat — anterior knee pain risk from patellar tracking concern").
  - If no catalog substitute exists, remove the exercise entirely and fill volume with a biomechanically safe alternative.
  - Never skip a flag, even if severity appears minor.
  - Do not introduce new risk flags by selecting exercises that load the same pattern.

━━━ PRIORITY 2 — POSTURE CORRECTION (posture) ━━━
For each postural attribute where observed = true:
  - Add 1–2 corrective exercises per affected region as setType "warmup" or "cooldown".
  - In specialInstructions, start with "posture: " then name the deviation (e.g. "posture: anterior pelvic tilt — hip flexor lengthening").
  - Reduce direct volume (by 1 set) for the overactive muscle group that antagonises the correction.
  - If observed = false for all postural attributes, make no posture changes.

━━━ PRIORITY 3 — MUSCLE REBALANCING (muscleBalance) ━━━
For each observed imbalance:
  - Shift 1–2 sets/week toward the underdeveloped side.
  - Reduce sets for the overdeveloped side by 1 where volume permits (never below minimum effective dose of 2 sets).
  - In specialInstructions, start with "balance: " then name the imbalance (e.g. "balance: posterior chain underdeveloped vs anterior — added Romanian deadlift").
  - If muscleBalance shows "balanced" across all axes, make no rebalancing changes.

━━━ PRIORITY 4 — BODY COMPOSITION ALIGNMENT (bodyComposition) ━━━
Align rep ranges and exercise density with the observed composition:
  - above_average / elevated body fat: prefer metabolic circuits, rest 45–75 s, 12–15 rep range, more compound supersets.
  - lean / athletic: emphasise progressive strength and hypertrophy (6–12 reps), rest 90–180 s.
  - average: use the athlete's primary fitnessGoal to decide rep range.
  In specialInstructions, start with "composition: " when the change is composition-driven.

━━━ STRUCTURAL HARD CONSTRAINTS ━━━
- The output "schedule" MUST contain exactly ${MIN_PLAN_DAYS} day objects — same count as the input plan (${MIN_PLAN_DAYS} consecutive calendar days). Do not add or remove days.
- PRESERVE the ${MIN_PLAN_DAYS}-day calendar structure exactly: same dateKeys, same rest days, same weekday pattern.
- PRESERVE the training split (same push/pull/legs or other chosen structure) — do not change which muscles are trained each day.
- Do NOT add extra training days beyond workoutDays.
- Total weekly set count must not increase by more than 20% vs a baseline plan for this athlete profile.
- Every exercise that is added, substituted, or has its volume modified MUST have a non-empty specialInstructions. Use the category prefix (safety/posture/balance/composition).
- Exercises with no photo-driven change may keep their existing specialInstructions unchanged.
- All exerciseIndex values must remain valid (0 … N-1 from the EXERCISES array).
</photo_refinement_instructions>`;
}

// ---------------------------------------------------------------------------
// Post-processing helpers
// ---------------------------------------------------------------------------

const ALLOWED_SET_TYPES = new Set([
  "warmup",
  "main",
  "cooldown",
  "superset",
  "dropset",
]);

function normalizeSetType(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (ALLOWED_SET_TYPES.has(s)) return s;
  if (s === "drop set" || s === "drop-set") return "dropset";
  if (s === "compound" || s === "isolation" || s === "accessory") return "main";
  return "main";
}

function resolveExerciseIndices(schedule, exercises) {
  const n = exercises.length;
  const allowedSet = new Set(exercises.map((e) => e._id.toString()));

  for (const day of schedule) {
    if (day.isRestDay || !day.exercises?.length) {
      day.exercises = [];
      continue;
    }
    const out = [];
    for (const ex of day.exercises) {
      const idRaw = ex.exerciseId != null ? String(ex.exerciseId).trim() : "";
      if (idRaw && allowedSet.has(idRaw)) {
        out.push({ ...ex, exerciseId: idRaw });
        continue;
      }
      const raw = ex.exerciseIndex ?? ex.exercise_index;
      const idx =
        typeof raw === "string" && /^\d+$/.test(raw)
          ? Number.parseInt(raw, 10)
          : raw;
      if (typeof idx !== "number" || Number.isNaN(idx) || idx < 0 || idx >= n) {
        console.warn("[WorkoutGen] Dropping invalid exercise", {
          dateKey: day.dateKey,
          exerciseIndex: raw,
          maxIndex: n - 1,
        });
        continue;
      }
      const doc = exercises[idx];
      out.push({ ...ex, exerciseId: doc._id.toString(), exerciseIndex: idx });
    }
    day.exercises = out;
  }
}

function clampReps(schedule, exercises = []) {
  const cardioIds = new Set(
    exercises
      .filter((e) => e.exerciseType === "cardio")
      .map((e) => e._id.toString()),
  );
  for (const day of schedule) {
    for (const ex of day.exercises || []) {
      if (cardioIds.has(String(ex.exerciseId))) {
        ex.prescribedSets = 1;
        ex.prescribedRepMin = null;
        ex.prescribedRepMax = null;
        ex.prescribedDurationMinutes = Math.max(
          10,
          Math.min(60, Number(ex.prescribedDurationMinutes ?? 20)),
        );
        if (ex.prescribedSpeed != null) {
          ex.prescribedSpeed = Math.max(0, Number(ex.prescribedSpeed));
        }
        if (ex.prescribedIncline != null) {
          ex.prescribedIncline = Math.max(0, Number(ex.prescribedIncline));
        }
        continue;
      }
      ex.prescribedRepMin = Math.max(6, Math.min(15, ex.prescribedRepMin ?? 8));
      ex.prescribedRepMax = Math.max(
        6,
        Math.min(15, ex.prescribedRepMax ?? 12),
      );
      if (ex.prescribedRepMin > ex.prescribedRepMax) {
        [ex.prescribedRepMin, ex.prescribedRepMax] = [
          ex.prescribedRepMax,
          ex.prescribedRepMin,
        ];
      }
    }
  }
}

function clampVolume(schedule) {
  for (const day of schedule) {
    for (const ex of day.exercises || []) {
      ex.prescribedSets = Math.max(1, Math.min(5, ex.prescribedSets ?? 3));
      ex.prescribedRestSeconds = Math.max(
        30,
        Math.min(300, ex.prescribedRestSeconds ?? 90),
      );
    }
    if (day.exercises?.length > 10) {
      day.exercises = day.exercises.slice(0, 10);
    }
  }
}

/** Keeps first MAX_PLAN_DAYS entries; 21–30 inclusive is accepted as-is. */
function normalizeScheduleLength(schedule, logTag) {
  if (!schedule?.length) return;
  if (schedule.length <= MAX_PLAN_DAYS) return;
  const removed = schedule.length - MAX_PLAN_DAYS;
  schedule.splice(MAX_PLAN_DAYS);
  console.warn(
    `[${logTag}] trimmed ${removed} excess day(s) from end; using ${MAX_PLAN_DAYS} days`,
  );
}

function validateSchedule(schedule, allowedIds) {
  const idSet = new Set(allowedIds.map(String));
  const errors = [];

  if (!schedule?.length) {
    errors.push("Schedule is empty");
    return errors;
  }
  if (schedule.length < MIN_PLAN_DAYS) {
    errors.push(
      `Expected at least ${MIN_PLAN_DAYS} days, got ${schedule.length}`,
    );
  }
  if (schedule.length > MAX_PLAN_DAYS) {
    errors.push(
      `Expected at most ${MAX_PLAN_DAYS} days, got ${schedule.length}`,
    );
  }

  const seenDates = new Set();
  for (const day of schedule) {
    if (!day.dateKey) {
      errors.push("Day missing dateKey");
      continue;
    }
    if (seenDates.has(day.dateKey)) {
      errors.push(`Duplicate dateKey: ${day.dateKey}`);
    }
    seenDates.add(day.dateKey);

    if (day.isRestDay) continue;

    if (!day.exercises?.length) {
      errors.push(`${day.dateKey}: non-rest day has no exercises`);
      continue;
    }
    for (const ex of day.exercises) {
      const id = ex.exerciseId != null ? String(ex.exerciseId).trim() : "";
      if (!idSet.has(id)) {
        errors.push(
          `${day.dateKey}: exercise ${id || "(missing)"} not in allowed set`,
        );
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Persist calendar plan to Mongo
// ---------------------------------------------------------------------------

/** MongoDB may abort overlapping transactions (e.g. two writers updating User). */
function isRetryableTransactionError(err) {
  if (!err) return false;
  const labels = err.errorLabels;
  if (Array.isArray(labels)) {
    if (labels.includes("TransientTransactionError")) return true;
    if (labels.includes("UnknownTransactionCommitResult")) return true;
  }
  if (err.code === 112) return true; // WriteConflict
  if (/has been aborted/i.test(String(err.message || ""))) return true;
  return false;
}

async function persistCalendarPlanOnce(
  userId,
  plan,
  onboardingSnapshot,
  bodySnapshot,
  timeZone,
  dailyStepGoal,
  refinementMeta = {},
) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // For photo-refinement plans, archive any active plans inside the same
    // transaction so the user is never left planless if the LLM call fails.
    if (refinementMeta.generationType === "photo_refinement") {
      await WorkoutPlan.updateMany(
        { user: userId, status: "active" },
        { $set: { status: "archived" } },
        { session },
      );
    }

    const planDoc = {
      user: userId,
      name: plan.planName || `${plan.schedule.length}-Day Workout Plan`,
      status: "active",
      planShape: "calendar",
      generatedAt: new Date(),
      onboardingSnapshot: { ...onboardingSnapshot, body: bodySnapshot },
      startDate: new Date(`${plan.schedule[0].dateKey}T00:00:00Z`),
      endDate: new Date(
        `${plan.schedule[plan.schedule.length - 1].dateKey}T23:59:59Z`,
      ),
      dailyStepGoal,
    };

    if (refinementMeta.generationType)
      planDoc.generationType = refinementMeta.generationType;
    if (refinementMeta.sourceBodyPhotos)
      planDoc.sourceBodyPhotos = refinementMeta.sourceBodyPhotos;
    if (refinementMeta.supersedesPlanId)
      planDoc.supersedesPlanId = refinementMeta.supersedesPlanId;
    if (refinementMeta.metadata) planDoc.metadata = refinementMeta.metadata;

    const [workoutPlan] = await WorkoutPlan.create([planDoc], { session });

    for (let i = 0; i < plan.schedule.length; i++) {
      const day = plan.schedule[i];
      const missedAfter = day.isRestDay
        ? null
        : computeMissedAfterUtc(day.dateKey, timeZone);

      const [workoutDay] = await WorkoutDay.create(
        [
          {
            workoutPlan: workoutPlan._id,
            dayNumber: i + 1,
            scheduledDateKey: day.dateKey,
            isRestDay: !!day.isRestDay,
            name: day.isRestDay ? day.name || "Rest Day" : day.name || "",
            estimatedDurationMinutes: day.isRestDay
              ? null
              : day.estimatedDurationMinutes || null,
            exerciseCount: day.isRestDay ? 0 : day.exercises?.length || 0,
            proTip: day.isRestDay ? "" : day.proTip || "",
            status: "planned",
            timeZone,
            missedAfterUtc: missedAfter,
          },
        ],
        { session },
      );

      if (!day.isRestDay && day.exercises?.length) {
        const dayExercises = day.exercises.map((ex) => ({
          workoutDay: workoutDay._id,
          exercise: new mongoose.Types.ObjectId(ex.exerciseId),
          orderInDay: ex.orderInDay,
          prescribedSets: ex.prescribedSets ?? null,
          prescribedRepMin: ex.prescribedRepMin ?? null,
          prescribedRepMax: ex.prescribedRepMax ?? null,
          prescribedRestSeconds: ex.prescribedRestSeconds ?? 60,
          prescribedDurationMinutes: ex.prescribedDurationMinutes ?? null,
          prescribedSpeed: ex.prescribedSpeed ?? null,
          prescribedIncline: ex.prescribedIncline ?? null,
          specialInstructions: ex.specialInstructions || "",
          setType: normalizeSetType(ex.setType),
        }));
        await WorkoutDayExercise.insertMany(dayExercises, { session });
      }
    }

    await User.findByIdAndUpdate(
      userId,
      { $set: { currentWorkoutPlan: workoutPlan._id } },
      { session },
    );

    await session.commitTransaction();
    return workoutPlan;
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      /* session may already be aborted server-side */
    }
    throw err;
  } finally {
    session.endSession();
  }
}

const PERSIST_TX_MAX_ATTEMPTS = 4;

async function persistCalendarPlan(
  userId,
  plan,
  onboardingSnapshot,
  bodySnapshot,
  timeZone,
  dailyStepGoal,
  refinementMeta = {},
) {
  let lastErr;
  for (let attempt = 1; attempt <= PERSIST_TX_MAX_ATTEMPTS; attempt++) {
    try {
      return await persistCalendarPlanOnce(
        userId,
        plan,
        onboardingSnapshot,
        bodySnapshot,
        timeZone,
        dailyStepGoal,
        refinementMeta,
      );
    } catch (err) {
      lastErr = err;
      const retry =
        isRetryableTransactionError(err) && attempt < PERSIST_TX_MAX_ATTEMPTS;
      if (!retry) throw err;
      const delayMs = 120 * 2 ** (attempt - 1);
      console.warn("[WorkoutGen] persist transaction retry", {
        attempt,
        delayMs,
        message: err?.message,
        labels: err?.errorLabels,
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Shared: call LLM, post-process, persist, return populated plan
// ---------------------------------------------------------------------------

async function callLlmAndPersist({
  user,
  bodyDetails,
  exercises,
  allowedIds,
  catalogKey,
  todayDateKey,
  timeZone,
  dailyStepGoal,
  extraPromptSection,
  refinementMeta,
  logTag,
}) {
  const started = Date.now();
  const userId = user._id?.toString?.() ?? String(user._id);
  const cardioBudget = computeCardioBudget(user.fitnessGoals);

  const rulesDoc = await TrainerRules.findOne({ catalogKey }).lean();
  if (!rulesDoc) {
    console.warn(
      `[${logTag}] No TrainerRules for "${catalogKey}", using fallback`,
    );
  }

  const systemPrompt = buildSystemPrompt(rulesDoc?.content || FALLBACK_RULES);
  let userPrompt = buildUserPrompt(
    user,
    bodyDetails,
    exercises,
    todayDateKey,
    timeZone,
    cardioBudget,
  );
  if (extraPromptSection) {
    userPrompt += extraPromptSection;
  }

  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  console.log(`[${logTag}] LLM response`, {
    finishReason: completion.choices[0]?.finish_reason,
    usage: completion.usage,
    ms: Date.now() - started,
  });

  let plan;
  try {
    plan = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("LLM returned invalid JSON"), {
      status: 502,
    });
  }

  if (!plan.schedule && plan.days) {
    plan.schedule = plan.days;
  }

  resolveExerciseIndices(plan.schedule || [], exercises);
  clampReps(plan.schedule || [], exercises);
  clampVolume(plan.schedule || []);
  normalizeScheduleLength(plan.schedule || [], logTag);

  const errors = validateSchedule(plan.schedule, allowedIds);
  if (errors.length > 0) {
    console.warn(`[${logTag}] validation issues`, errors);
    for (const day of plan.schedule || []) {
      if (day.isRestDay) continue;
      day.exercises = (day.exercises || []).filter((ex) =>
        allowedIds.includes(String(ex.exerciseId)),
      );
    }
  }

  const totalExercises = (plan.schedule || []).reduce(
    (s, d) => s + (d.exercises?.length || 0),
    0,
  );
  console.log(`[${logTag}] plan normalized`, {
    planName: plan.planName,
    days: plan.schedule?.length,
    totalExercises,
    dailyStepGoal,
    ms: Date.now() - started,
  });

  const onboardingSnapshot = {
    fitnessGoals: user.fitnessGoals,
    fitnessLevel: user.fitnessLevel,
    workoutEnvironment: user.workoutEnvironment,
    weightliftingExperience: user.weightliftingExperience,
    workoutDays: user.workoutDays,
    focusAreas: user.focusAreas,
    catalogKey,
  };
  const bodySnapshot = {
    gender: bodyDetails.gender,
    age: bodyDetails.age,
    weightKg: bodyDetails.weight,
    heightCm: bodyDetails.height,
  };

  await ensureMongoConnected();

  const workoutPlan = await persistCalendarPlan(
    user._id,
    plan,
    onboardingSnapshot,
    bodySnapshot,
    timeZone,
    dailyStepGoal,
    refinementMeta,
  );

  console.log(`[${logTag}] persisted`, {
    workoutPlanId: workoutPlan._id?.toString(),
    ms: Date.now() - started,
  });

  const days = await WorkoutDay.find({ workoutPlan: workoutPlan._id })
    .sort({ dayNumber: 1 })
    .lean();

  const dayIds = days.filter((d) => !d.isRestDay).map((d) => d._id);
  const dayExercises = await WorkoutDayExercise.find({
    workoutDay: { $in: dayIds },
  })
    .populate(
      "exercise",
      "name exerciseType muscleGroups equipment difficultyLevel videoUrl thumbnailUrl",
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

  console.log(`[${logTag}] done`, { ms: Date.now() - started });

  return { workoutPlan, days: populatedDays };
}

// ---------------------------------------------------------------------------
// Shared context loader
// ---------------------------------------------------------------------------

async function loadGenerationContext(user) {
  const bodyDetails = await BodyDetails.findOne({ user: user._id })
    .sort({ updatedAt: -1 })
    .lean();
  if (!bodyDetails) {
    throw Object.assign(
      new Error("Body details are required before generating a plan."),
      { status: 400 },
    );
  }

  const catalogKey = deriveCatalogKey(
    bodyDetails.gender,
    user.workoutEnvironment,
  );
  const exercises = await loadCatalogExercises(catalogKey);
  if (exercises.length === 0) {
    throw Object.assign(
      new Error(
        `No exercises found for catalog "${catalogKey}". Seed exercises first.`,
      ),
      { status: 500 },
    );
  }

  const allowedIds = exercises.map((e) => e._id.toString());
  const dailyStepGoal = computeDailyStepGoal(user);

  return { bodyDetails, catalogKey, exercises, allowedIds, dailyStepGoal };
}

// ---------------------------------------------------------------------------
// Public: calendar plan generation (3 weeks)
// ---------------------------------------------------------------------------

/**
 * Generate a 3-week calendar-mapped workout plan.
 *
 * @param {object} user          Mongoose User document
 * @param {string} todayDateKey  YYYY-MM-DD in user's local time
 * @param {string} timeZone      IANA timezone
 * @returns {Promise<object>}    { workoutPlan, days }
 */
export async function generateCalendarWorkoutPlan(
  user,
  todayDateKey,
  timeZone,
) {
  const userId = user._id?.toString?.() ?? String(user._id);
  console.log("[WorkoutGen] start", {
    userId,
    todayDateKey,
    timeZone,
    model: CHAT_MODEL,
  });

  const { bodyDetails, catalogKey, exercises, allowedIds, dailyStepGoal } =
    await loadGenerationContext(user);

  console.log("[WorkoutGen] catalog loaded", {
    catalogKey,
    exerciseCount: exercises.length,
    workoutDayCount: user.workoutDays?.length,
    dailyStepGoal,
  });

  return callLlmAndPersist({
    user,
    bodyDetails,
    exercises,
    allowedIds,
    catalogKey,
    todayDateKey,
    timeZone,
    dailyStepGoal,
    extraPromptSection: null,
    refinementMeta: {},
    logTag: "WorkoutGen",
  });
}

// ---------------------------------------------------------------------------
// Public: photo-refined plan generation (3-week calendar)
// ---------------------------------------------------------------------------

/**
 * Generate a workout plan incorporating body-photo analysis.
 * Archives any existing active plan, then persists a new active plan.
 *
 * @param {object} user              Mongoose User document
 * @param {object} photoProfile      Validated vision-analysis output
 * @param {string|null} currentPlanId  Active plan superseded, or null
 * @param {string|ObjectId} bodyPhotosId  BodyPhotos document id
 * @returns {Promise<object>}        { workoutPlan, days }
 */
export async function generateRefinedWorkoutPlan(
  user,
  photoProfile,
  currentPlanId,
  bodyPhotosId,
) {
  const userId = user._id?.toString?.() ?? String(user._id);
  console.log("[WorkoutGen:Refined] start", {
    userId,
    model: CHAT_MODEL,
    supersedesPlanId: currentPlanId ? String(currentPlanId) : null,
  });

  const { bodyDetails, catalogKey, exercises, allowedIds, dailyStepGoal } =
    await loadGenerationContext(user);

  const timeZone = user.timeZone || "UTC";
  // Use en-CA locale which formats as YYYY-MM-DD — mirrors dateKeyInTimeZone utility.
  const todayDateKey = new Intl.DateTimeFormat("en-CA", { timeZone }).format(
    new Date(),
  );

  const refinementMeta = {
    generationType: "photo_refinement",
    sourceBodyPhotos: bodyPhotosId,
  };
  if (currentPlanId) {
    refinementMeta.supersedesPlanId = currentPlanId;
  }

  return callLlmAndPersist({
    user,
    bodyDetails,
    exercises,
    allowedIds,
    catalogKey,
    todayDateKey,
    timeZone,
    dailyStepGoal,
    extraPromptSection: buildPhotoRefinementSection(photoProfile),
    refinementMeta,
    logTag: "WorkoutGen:Refined",
  });
}
