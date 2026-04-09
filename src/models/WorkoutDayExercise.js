import mongoose from 'mongoose';

/**
 * WorkoutDayExercise – Links an exercise from bank to a workout day
 * with prescribed sets, reps, rest, or duration/speed/incline.
 * Supports special instructions (e.g. "Dropset last 2").
 */
const workoutDayExerciseSchema = new mongoose.Schema(
  {
    workoutDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutDay',
      required: true,
    },
    exercise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exercise',
      required: true,
    },
    orderInDay: {
      type: Number,
      required: true,
      min: 1,
      // 1, 2, 3, … (order in day; progress dots)
    },
    prescribedSets: {
      type: Number,
      min: 1,
      default: null,
      // e.g. 4
    },
    prescribedRepMin: {
      type: Number,
      min: 1,
      default: null,
      // e.g. 8
    },
    prescribedRepMax: {
      type: Number,
      min: 1,
      default: null,
      // e.g. 10
    },
    prescribedRestSeconds: {
      type: Number,
      min: 0,
      default: 60,
      // e.g. 60
    },
    prescribedDurationMinutes: {
      type: Number,
      min: 1,
      default: null,
      // Cardio target
    },
    prescribedSpeed: {
      type: Number,
      min: 0,
      default: null,
      // Cardio
    },
    prescribedIncline: {
      type: Number,
      min: 0,
      default: null,
      // Cardio
    },
    specialInstructions: {
      type: String,
      trim: true,
      default: '',
      // e.g. "Dropset last 2"
    },
    setType: {
      type: String,
      trim: true,
      lowercase: true,
      enum: ['warmup', 'main', 'cooldown', 'superset'],
      default: 'main',
      // e.g. 'warmup' | 'main' | 'cooldown' | 'superset'
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

// Indexes for efficient queries
workoutDayExerciseSchema.index({ workoutDay: 1, orderInDay: 1 }, { unique: true });
workoutDayExerciseSchema.index({ workoutDay: 1 });
workoutDayExerciseSchema.index({ exercise: 1 });

export default mongoose.model('WorkoutDayExercise', workoutDayExerciseSchema);
