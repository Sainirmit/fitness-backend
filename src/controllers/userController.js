import User from "../models/User.js";
import { normalizeOptionValue } from "../utils/onboardingNormalize.js";
import { createBodyDetailsForUser } from "../services/bodyDetailsService.js";

// Fields the client is NOT allowed to set directly
const PROTECTED_FIELDS = new Set([
  "email",
  "provider",
  "providerId",
  "hasUnlockedPlan",
]);

/**
 * GET /api/users/me
 * Returns the authenticated user's profile.
 */
export const getMe = async (req, res) => {
  return res.status(200).json({ user: req.user });
};

/**
 * PATCH /api/users/me
 *
 * Single flexible endpoint used at two points in onboarding:
 *
 * ── After Step 6 (post-auth, Phase 1) ──────────────────────────────────────
 *   {
 *     "name":         "Jane",
 *     "fitnessGoals": ["lose_weight", "build_muscle"],
 *     "fitnessLevel": "beginner",
 *     "motivations":  ["health_wellbeing", "stress_relief"]
 *   }
 *
 * ── After Step 11 (Phase 2, set onboardingCompleted: true) ─────────────────
 *   {
 *     "gender":                  "female",
 *     "age":                     28,
 *     "weight":                  130,
 *     "weightUnit":              "lbs",      ← stored as kg
 *     "height":                  65,         ← total inches when heightUnit="ft_in"
 *     "heightUnit":              "ft_in",    ← stored as cm
 *
 *     "workoutEnvironment":      "gym",
 *     "weightliftingExperience": true,
 *
 *     "workoutDays":             ["mon", "wed", "fri"],
 *     "preferredWorkoutTime":    "morning",
 *     "activityLevelApartFromWorkout": "moderate",
 *     "focusAreas":              ["back", "core_abs"],
 *
 *     "dietType":                "non_vegetarian",
 *     "mealsPerDay":             3,
 *
 *     "onboardingCompleted":     true
 *   }
 *
 * Body detail fields (gender, age, weight, height + units) upsert the single
 * BodyDetails document for this user — no separate API call needed.
 *
 * Response 200: { user, bodyDetails? }
 */
export const updateMe = async (req, res) => {
  // Guard against accidentally writing protected fields
  for (const field of PROTECTED_FIELDS) {
    if (field in req.body) {
      return res.status(400).json({
        message: `Field "${field}" cannot be updated via this endpoint.`,
      });
    }
  }

  const {
    // ── Phase 1 ──
    name,
    fitnessGoals,
    fitnessLevel,
    motivations,

    // ── Phase 2 – body details (upserts BodyDetails) ──
    gender,
    age,
    weight,
    weightUnit,
    height,
    heightUnit,

    // ── Phase 2 – workout / diet prefs ──
    workoutEnvironment,
    weightliftingExperience,
    workoutDays,
    preferredWorkoutTime,
    activityLevelApartFromWorkout,
    focusAreas,
    dietType,
    mealsPerDay,

    // ── Flag ──
    onboardingCompleted,
  } = req.body;

  // Build User update object (only include fields that were actually sent)
  const userUpdates = {};

  if (name !== undefined) userUpdates.name = name.trim();

  if (fitnessGoals !== undefined)
    userUpdates.fitnessGoals = fitnessGoals
      .map(normalizeOptionValue)
      .filter(Boolean);

  if (fitnessLevel !== undefined)
    userUpdates.fitnessLevel = normalizeOptionValue(fitnessLevel);

  if (motivations !== undefined)
    userUpdates.motivations = motivations
      .map(normalizeOptionValue)
      .filter(Boolean);

  if (workoutEnvironment !== undefined)
    userUpdates.workoutEnvironment = normalizeOptionValue(workoutEnvironment);

  if (weightliftingExperience !== undefined)
    userUpdates.weightliftingExperience = weightliftingExperience;

  if (workoutDays !== undefined)
    userUpdates.workoutDays = workoutDays
      .map(normalizeOptionValue)
      .filter(Boolean);

  if (preferredWorkoutTime !== undefined)
    userUpdates.preferredWorkoutTime =
      normalizeOptionValue(preferredWorkoutTime);

  if (activityLevelApartFromWorkout !== undefined)
    userUpdates.activityLevelApartFromWorkout = normalizeOptionValue(
      activityLevelApartFromWorkout,
    );

  if (focusAreas !== undefined)
    userUpdates.focusAreas = focusAreas
      .map(normalizeOptionValue)
      .filter(Boolean);

  if (dietType !== undefined)
    userUpdates.dietType = normalizeOptionValue(dietType);

  if (mealsPerDay !== undefined) userUpdates.mealsPerDay = mealsPerDay;

  if (onboardingCompleted !== undefined)
    userUpdates.onboardingCompleted = onboardingCompleted;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: userUpdates },
    { new: true, runValidators: true },
  );

  // ── Upsert BodyDetails if any core body-metric fields were sent ──
  const hasBodyFields = [gender, age, weight, height].some(
    (v) => v !== undefined,
  );

  let bodyDetails = null;

  if (hasBodyFields) {
    bodyDetails = await createBodyDetailsForUser(req.user._id, {
      gender,
      age,
      weight,
      weightUnit,
      height,
      heightUnit,
    });
  }

  return res.status(200).json({
    user,
    ...(bodyDetails && { bodyDetails }),
  });
};
