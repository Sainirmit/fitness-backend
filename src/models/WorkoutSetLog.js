import mongoose from 'mongoose';

/**
 * WorkoutSetLog – Per-set (or per-cardio block) log.
 * Supports strength (reps ± weight), bodyweight (reps only), and cardio (duration, speed, incline).
 */
const workoutSetLogSchema = new mongoose.Schema(
  {
    workoutSessionExercise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutSessionExercise',
      required: true,
      index: true,
    },
    setNumber: {
      type: Number,
      required: true,
      min: 1,
      // 1, 2, 3, 4, …
    },
    recordedReps: {
      type: Number,
      min: 0,
      default: null,
      // Strength/bodyweight
    },
    recordedWeight: {
      type: Number,
      min: 0,
      default: null,
      // Strength only
    },
    weightUnit: {
      type: String,
      trim: true,
      lowercase: true,
      enum: ['lbs', 'kg'],
      default: 'kg',
      // 'lbs' | 'kg'
    },
    recordedDurationMinutes: {
      type: Number,
      min: 0,
      default: null,
      // Cardio
    },
    recordedSpeed: {
      type: Number,
      min: 0,
      default: null,
      // Cardio
    },
    recordedIncline: {
      type: Number,
      min: 0,
      default: null,
      // Cardio
    },
    isCompleted: {
      type: Boolean,
      default: true,
      // Checkbox "Completed"
    },
    loggedAt: {
      type: Date,
      default: Date.now,
      // When set was logged
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

// Indexes for efficient queries
workoutSetLogSchema.index({ workoutSessionExercise: 1, setNumber: 1 }, { unique: true });
workoutSetLogSchema.index({ loggedAt: -1 });

export default mongoose.model('WorkoutSetLog', workoutSetLogSchema);
