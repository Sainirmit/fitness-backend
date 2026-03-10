import mongoose from 'mongoose';

/**
 * Exercise – Master catalog of exercises.
 * AI uses this bank to build workout plans. Each exercise has an associated video (AWS).
 */
const exerciseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
      // e.g. "Barbell Chest Press Incline", "Treadmill"
    },
    description: {
      type: String,
      trim: true,
      default: '',
      // Instructions / steps for exercise modal
    },
    videoUrl: {
      type: String,
      trim: true,
      required: true,
      // S3 or CDN URL for demo video
    },
    thumbnailUrl: {
      type: String,
      trim: true,
      default: '',
      // Optional thumbnail for lists/cards
    },
    exerciseType: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      enum: ['strength', 'cardio', 'bodyweight'],
      // 'strength' | 'cardio' | 'bodyweight'
    },
    muscleGroups: {
      type: [String],
      default: [],
      // e.g. ["chest", "triceps"]
    },
    equipment: {
      type: [String],
      default: [],
      // e.g. ["barbell", "bench"]
    },
    difficultyLevel: {
      type: String,
      trim: true,
      lowercase: true,
      enum: ['beginner', 'intermediate', 'advanced'],
      // 'beginner' | 'intermediate' | 'advanced'
    },
    defaultSets: {
      type: Number,
      min: 1,
      default: null,
      // Default number of sets
    },
    defaultRepMin: {
      type: Number,
      min: 1,
      default: null,
      // Default min reps (strength/bodyweight)
    },
    defaultRepMax: {
      type: Number,
      min: 1,
      default: null,
      // Default max reps (strength/bodyweight)
    },
    defaultRestSeconds: {
      type: Number,
      min: 0,
      default: 60,
      // Default rest between sets (seconds)
    },
    defaultDurationMinutes: {
      type: Number,
      min: 1,
      default: null,
      // Default duration for cardio
    },
    defaultSpeed: {
      type: Number,
      min: 0,
      default: null,
      // Default speed (cardio)
    },
    defaultIncline: {
      type: Number,
      min: 0,
      default: null,
      // Default incline (cardio)
    },
    isActive: {
      type: Boolean,
      default: true,
      // Set false to hide from catalog
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

// Indexes for efficient queries
exerciseSchema.index({ exerciseType: 1 });
exerciseSchema.index({ isActive: 1 });
exerciseSchema.index({ muscleGroups: 1 });
exerciseSchema.index({ equipment: 1 });
exerciseSchema.index({ name: 'text', description: 'text' }); // For search

export default mongoose.model('Exercise', exerciseSchema);
