import User from '../models/User.js';
import BodyDetails from '../models/BodyDetails.js';
import {
  normalizeOptionValue,
  normalizeHomeEquipment,
} from '../utils/onboardingNormalize.js';

// --- Unit conversion helpers ---
const lbsToKg = (lbs) => Math.round(lbs * 0.453592 * 10) / 10;
// heightUnit "ft_in" → frontend sends total inches (e.g. 5'11" → 71)
const inchesToCm = (inches) => Math.round(inches * 2.54 * 10) / 10;

// Fields the client is NOT allowed to set directly
const PROTECTED_FIELDS = new Set([
  'email',
  'provider',
  'providerId',
  'hasUnlockedPlan',
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
 *     "activityLevel":           "moderate",
 *     "focusAreas":              ["back", "core_abs"],
 *
 *     "dietType":                "non_vegetarian",
 *     "mealsPerDay":             3,
 *
 *     "onboardingCompleted":     true
 *   }
 *
 * Body detail fields (gender, age, weight, height + units) create a new
 * BodyDetails snapshot automatically — no separate API call needed.
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

    // ── Phase 2 – body details (creates BodyDetails snapshot) ──
    gender,
    age,
    weight,
    weightUnit,
    height,
    heightUnit,

    // ── Phase 2 – workout / diet prefs ──
    workoutEnvironment,
    weightliftingExperience,
    homeEquipment,
    workoutDays,
    preferredWorkoutTime,
    activityLevel,
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

  if (homeEquipment !== undefined) {
    userUpdates.homeEquipment = Array.isArray(homeEquipment)
      ? homeEquipment.map(normalizeOptionValue).filter(Boolean)
      : normalizeHomeEquipment(homeEquipment); // handles free-text string
  }

  if (workoutDays !== undefined)
    userUpdates.workoutDays = workoutDays
      .map(normalizeOptionValue)
      .filter(Boolean);

  if (preferredWorkoutTime !== undefined)
    userUpdates.preferredWorkoutTime = normalizeOptionValue(preferredWorkoutTime);

  if (activityLevel !== undefined)
    userUpdates.activityLevel = normalizeOptionValue(activityLevel);

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
    { new: true, runValidators: true }
  );

  // ── Create BodyDetails snapshot if any body-metric fields were sent ──
  const hasBodyFields = [gender, age, weight, height].some(
    (v) => v !== undefined
  );

  let bodyDetails = null;

  if (hasBodyFields) {
    // Convert to canonical storage units (kg, cm)
    const storedWeight =
      weight !== undefined && weightUnit === 'lbs' ? lbsToKg(weight) : weight;

    const storedHeight =
      height !== undefined && heightUnit === 'ft_in'
        ? inchesToCm(height)  // expects total inches
        : height;

    bodyDetails = await BodyDetails.create({
      user: req.user._id,
      ...(gender !== undefined && { gender }),
      ...(age !== undefined && { age }),
      ...(storedWeight !== undefined && { weight: storedWeight }),
      ...(weightUnit !== undefined && { weightUnit }),
      ...(storedHeight !== undefined && { height: storedHeight }),
      ...(heightUnit !== undefined && { heightUnit }),
    });
  }

  return res.status(200).json({
    user,
    ...(bodyDetails && { bodyDetails }),
  });
};
