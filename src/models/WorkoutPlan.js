import mongoose from 'mongoose';

/**
 * WorkoutPlan – One AI-generated plan per user (or per generation).
 * Created after payment when OpenAI is called with onboarding data.
 */
const workoutPlanSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
      default: '',
      // e.g. "My Workout Plan"
    },
    status: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      enum: ['pending_generation', 'active', 'completed', 'archived'],
      default: 'pending_generation',
      // 'pending_generation' | 'active' | 'completed' | 'archived'
    },
    generatedAt: {
      type: Date,
      default: Date.now,
      // When AI plan was created
    },
    onboardingSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // Snapshot of onboarding data sent to OpenAI (audit/re-run)
    },
    startDate: {
      type: Date,
      default: null,
      // Plan start date
    },
    endDate: {
      type: Date,
      default: null,
      // Plan end date
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      // Extra AI/provider metadata
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

// Indexes for efficient queries
workoutPlanSchema.index({ user: 1, status: 1, generatedAt: -1 });
workoutPlanSchema.index({ user: 1 });
workoutPlanSchema.index({ status: 1 });

export default mongoose.model('WorkoutPlan', workoutPlanSchema);
