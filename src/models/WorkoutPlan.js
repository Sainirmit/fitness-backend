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
      enum: ['pending_generation', 'generating', 'active', 'failed', 'completed', 'archived'],
      default: 'pending_generation',
    },
    generationError: {
      type: String,
      trim: true,
      default: null,
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

    planShape: {
      type: String,
      trim: true,
      lowercase: true,
      enum: ['template', 'calendar'],
      default: 'template',
    },

    // ── Photo-based refinement tracking ──
    generationType: {
      type: String,
      trim: true,
      lowercase: true,
      enum: ['initial', 'photo_refinement'],
      default: 'initial',
    },
    sourceBodyPhotos: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BodyPhotos',
      default: null,
    },
    supersedesPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutPlan',
      default: null,
    },

    dailyStepGoal: {
      type: Number,
      min: 0,
      default: null,
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
