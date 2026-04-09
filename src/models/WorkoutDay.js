import mongoose from 'mongoose';

/**
 * WorkoutDay – One "day" in a workout plan.
 *
 * Template plans (planShape "template"): dayNumber 1..N, scheduledDateKey is null.
 * Calendar plans (planShape "calendar"):  dayNumber 1..28, each row has a
 * unique scheduledDateKey (YYYY-MM-DD) and may be a rest day.
 */
const workoutDaySchema = new mongoose.Schema(
  {
    workoutPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutPlan',
      required: true,
    },
    dayNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    scheduledDateKey: {
      type: String,
      trim: true,
      default: null,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    isRestDay: {
      type: Boolean,
      default: false,
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    estimatedDurationMinutes: {
      type: Number,
      min: 1,
      default: null,
    },
    exerciseCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    iconIdentifier: {
      type: String,
      trim: true,
      default: '',
    },
    proTip: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      trim: true,
      lowercase: true,
      enum: ['planned', 'in_progress', 'completed', 'skipped', 'missed'],
      default: 'planned',
    },

    // Calendar-plan fields (null for template-shaped plans)
    timeZone: {
      type: String,
      trim: true,
      default: null,
    },
    missedAfterUtc: {
      type: Date,
      default: null,
    },
    activeSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutSession',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false, transform: (_, ret) => { delete ret.__v; return ret; } },
    toObject: { virtuals: false },
  }
);

workoutDaySchema.index({ workoutPlan: 1, dayNumber: 1 }, { unique: true });
workoutDaySchema.index({ workoutPlan: 1 });
workoutDaySchema.index(
  { workoutPlan: 1, scheduledDateKey: 1 },
  { unique: true, sparse: true },
);
workoutDaySchema.index({ scheduledDateKey: 1 });
workoutDaySchema.index({ missedAfterUtc: 1, status: 1 });

export default mongoose.model('WorkoutDay', workoutDaySchema);
