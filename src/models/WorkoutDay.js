import mongoose from 'mongoose';

/**
 * WorkoutDay – One "day" in a workout plan.
 * e.g. "Day 1: Chest & Triceps", with estimated duration, exercise count, and pro tip.
 */
const workoutDaySchema = new mongoose.Schema(
  {
    workoutPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutPlan',
      required: true,
      index: true,
    },
    dayNumber: {
      type: Number,
      required: true,
      min: 1,
      // 1, 2, 3, …
    },
    name: {
      type: String,
      trim: true,
      default: '',
      // e.g. "Chest & Triceps", "Delts & Core"
    },
    estimatedDurationMinutes: {
      type: Number,
      min: 1,
      default: null,
      // e.g. 85 for "1h 25m"
    },
    exerciseCount: {
      type: Number,
      min: 0,
      default: 0,
      // Denormalized count for list UI
    },
    iconIdentifier: {
      type: String,
      trim: true,
      default: '',
      // e.g. "chest_triceps" for UI asset
    },
    proTip: {
      type: String,
      trim: true,
      default: '',
      // Pro tip for that day
    },
    status: {
      type: String,
      trim: true,
      lowercase: true,
      enum: ['planned', 'completed', 'skipped'],
      default: 'planned',
      // e.g. 'planned' | 'completed' | 'skipped'
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

// Indexes for efficient queries
workoutDaySchema.index({ workoutPlan: 1, dayNumber: 1 }, { unique: true });
workoutDaySchema.index({ workoutPlan: 1 });

export default mongoose.model('WorkoutDay', workoutDaySchema);
