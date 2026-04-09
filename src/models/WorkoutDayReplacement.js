import mongoose from 'mongoose';

/**
 * WorkoutDayReplacement – persists a user's decision to swap one workout day
 * with another from the same plan.
 *
 * Example: user replaces "Back & Biceps" (originalWorkoutDay) with
 *          "Chest & Triceps" (replacementWorkoutDay).
 *          The dashboard then serves Chest exercises wherever Back was scheduled.
 *
 * One row per originalWorkoutDay — replacing again overwrites the previous swap.
 */
const workoutDayReplacementSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    workoutPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutPlan',
      required: true,
      index: true,
    },
    originalWorkoutDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutDay',
      required: true,
    },
    replacementWorkoutDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutDay',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  },
);

workoutDayReplacementSchema.index(
  { user: 1, workoutPlan: 1, originalWorkoutDay: 1 },
  { unique: true },
);

export default mongoose.model('WorkoutDayReplacement', workoutDayReplacementSchema);
