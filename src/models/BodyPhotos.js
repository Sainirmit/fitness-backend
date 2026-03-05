import mongoose from 'mongoose';

/**
 * BodyPhotos – one document per photo set (front + side) per user.
 * Supports onboarding photos plus weekly/monthly progress tracking over time.
 * URLs are hosted elsewhere (e.g. S3, CDN); upload flow to be added later.
 */
const bodyPhotosSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    bodyDetails: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BodyDetails',
      default: null,
      // When set, this photo set belongs to that BodyDetails snapshot (e.g. same check-in).
    },
    frontImageUrl: {
      type: String,
      trim: true,
      default: '',
      // Hosted URL for front body photo.
    },
    sideImageUrl: {
      type: String,
      trim: true,
      default: '',
      // Hosted URL for side body photo.
    },
    // When this set was taken; use for weekly/monthly progress and ordering.
    recordedAt: {
      type: Date,
      default: Date.now,
    },
    // Optional: e.g. "onboarding" | "weekly" | "monthly" for filtering progress type.
    periodType: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

// Latest photos per user; list by date for progress timeline.
bodyPhotosSchema.index({ user: 1, recordedAt: -1 });
// Photos for a given BodyDetails (check-in) lookup.
bodyPhotosSchema.index({ bodyDetails: 1 });

export default mongoose.model('BodyPhotos', bodyPhotosSchema);
