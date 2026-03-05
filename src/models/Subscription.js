import mongoose from 'mongoose';

/**
 * Subscription model – tracks paywall unlock and plan access (MyTrainr AI).
 * Linked to User; one active subscription per user at a time.
 */
const subscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      default: 'active',
      // e.g. "active" | "canceled" | "expired" | "trialing"
    },
    provider: {
      type: String,
      trim: true,
      lowercase: true,
      // e.g. "stripe" | "apple_iap" | "google_play"
    },
    externalId: {
      type: String,
      trim: true,
      sparse: true,
      // ID from payment provider
    },
    planUnlockedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

subscriptionSchema.index({ user: 1, status: 1 });

export default mongoose.model('Subscription', subscriptionSchema);
