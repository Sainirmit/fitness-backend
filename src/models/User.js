import mongoose from "mongoose";

/**
 * User model – holds auth + onboarding preferences (MyTrainr AI).
 * Body/biometrics live in BodyDetails collection for history tracking.
 * Prefer normalized strings (e.g. "build_muscle") over enums for flexibility.
 */
const userSchema = new mongoose.Schema(
  {
    // --- Auth (set at Sign Up) ---
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    provider: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      // e.g. "google" | "apple"
    },
    providerId: {
      type: String,
      trim: true,
      sparse: true,
      // External ID from Google/Apple for linking accounts
    },

    // --- Pre–sign up onboarding (Name, Goals, Level, Motivation) ---
    name: {
      type: String,
      trim: true,
      default: "",
    },
    fitnessGoals: {
      type: [String],
      default: [],
      // e.g. ["lose_weight", "build_muscle", "improve_endurance"]
    },
    fitnessLevel: {
      type: String,
      trim: true,
      default: "",
      // e.g. "beginner" | "intermediate" | "advanced"
    },
    motivations: {
      type: [String],
      default: [],
      // e.g. ["health_wellbeing", "stress_relief"]
    },

    // --- Workout environment ---
    workoutEnvironment: {
      type: String,
      trim: true,
      default: "",
      // "gym" | "home"
    },
    weightliftingExperience: {
      type: Boolean,
      default: null,
      // Only when workoutEnvironment === "gym"
    },

    // --- Workout frequency & focus ---
    workoutDays: {
      type: [String],
      default: [],
      // e.g. ["mon", "wed", "fri"]
    },
    preferredWorkoutTime: {
      type: String,
      trim: true,
      default: "",
      // e.g. "morning" | "afternoon" | "evening" | "night"
    },
    activityLevelApartFromWorkout: {
      type: String,
      trim: true,
      default: "",
      // Daily activity outside workouts — e.g. "none" | "light" | "moderate" | "very_active"
    },
    focusAreas: {
      type: [String],
      default: [],
      // e.g. ["back", "arms", "core_abs", "full_body"]
    },

    // --- Diet ---
    dietType: {
      type: String,
      trim: true,
      default: "",
      // e.g. "non_vegetarian" | "vegetarian_with_eggs" | "vegan"
    },
    mealsPerDay: {
      type: Number,
      min: 2,
      max: 10,
      default: null,
      // 2, 3, 4, or 5+
    },

    // --- Progress & paywall ---
    onboardingCompleted: {
      type: Boolean,
      default: false,
    },
    hasUnlockedPlan: {
      type: Boolean,
      default: false,
      // Set after successful paywall / subscription
    },
    hasBodyPhotos: {
      type: Boolean,
      default: false,
      // True once user uploads at least one front+side photo set
    },
    currentWorkoutPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkoutPlan",
      default: null,
      // Optional: Quick reference to user's active workout plan
    },
    timeZone: {
      type: String,
      trim: true,
      default: "UTC",
      // IANA timezone, e.g. "America/New_York"
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: false,
      transform: (_, ret) => {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: false },
  },
);

// Index for auth lookups
userSchema.index({ email: 1, provider: 1 }, { unique: true });

export default mongoose.model("User", userSchema);
