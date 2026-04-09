import mongoose from 'mongoose';

/**
 * BodyDetails – separate collection for body/biometrics (MyTrainr AI).
 * One document per user (updated on profile changes or re-onboarding).
 * Weight stored in kg, height in cm; display units kept for UI.
 */
const bodyDetailsSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    gender: {
      type: String,
      trim: true,
      default: '',
      // e.g. "male" | "female" | "other"
    },
    age: {
      type: Number,
      min: 1,
      max: 120,
      default: null,
    },
    weight: {
      type: Number,
      min: 0,
      default: null,
      // Always stored in kg
    },
    weightUnit: {
      type: String,
      trim: true,
      default: '',
      // "kg" | "lbs" – for display only
    },
    height: {
      type: Number,
      min: 0,
      default: null,
      // Always stored in cm
    },
    heightUnit: {
      type: String,
      trim: true,
      default: 'cm',
      // "cm" | "ft_in" – for display only
    },
    // Optional: allow backdating (e.g. manual log). Defaults to createdAt.
    recordedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

// Latest body details per user (for "current" snapshot)
bodyDetailsSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('BodyDetails', bodyDetailsSchema);
