import mongoose from 'mongoose';

/**
 * WorkoutSessionExercise – Links a workout session to each planned exercise
 * so we know order and can attach set logs.
 * Prescribed parameters come from WorkoutDayExercise (and Exercise).
 */
const workoutSessionExerciseSchema = new mongoose.Schema(
  {
    workoutSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutSession',
      required: true,
      index: true,
    },
    workoutDayExercise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutDayExercise',
      required: true,
      index: true,
      // Planned exercise (has ref to Exercise + prescribed params)
    },
    orderInSession: {
      type: Number,
      required: true,
      min: 1,
      // 1, 2, … (matches UI order)
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

// Indexes for efficient queries
workoutSessionExerciseSchema.index({ workoutSession: 1, orderInSession: 1 }, { unique: true });

export default mongoose.model('WorkoutSessionExercise', workoutSessionExerciseSchema);
