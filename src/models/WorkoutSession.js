import mongoose from 'mongoose';

/**
 * WorkoutSession – One instance of a user performing a workout (a specific WorkoutDay).
 * Tracks in-progress, completed, or discarded, plus post-workout feedback.
 */
const workoutSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    workoutDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutDay',
      required: true,
      index: true,
    },
    workoutPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutPlan',
      index: true,
      // Denormalized for queries
    },
    status: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      enum: ['in_progress', 'completed', 'discarded'],
      default: 'in_progress',
      // 'in_progress' | 'completed' | 'discarded'
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
      // When user started (after countdown)
    },
    completedAt: {
      type: Date,
      default: null,
      // When "Finish" was pressed
    },
    totalDurationMinutes: {
      type: Number,
      min: 0,
      default: null,
      // "How long was your workout?" (e.g. 150 for 2h 30m)
    },
    strenuousnessRating: {
      type: String,
      trim: true,
      lowercase: true,
      enum: ['light', 'moderate', 'difficult'],
      default: null,
      // 'light' | 'moderate' | 'difficult'
    },
    energyLevelRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
      // 1–5, "How was your energy?"
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

// Indexes for efficient queries
workoutSessionSchema.index({ user: 1, startedAt: -1 });
workoutSessionSchema.index({ workoutDay: 1 });
workoutSessionSchema.index({ status: 1 });
workoutSessionSchema.index({ user: 1, status: 1 });

export default mongoose.model('WorkoutSession', workoutSessionSchema);
