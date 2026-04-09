import mongoose from 'mongoose';

/**
 * One row per (user, plan, workout template day, calendar date).
 * Drives weekly card states; template WorkoutDay.status is mirrored for the current week
 * and reset via POST /api/workout-plans/current/reset-template-status.
 */
const workoutDayOccurrenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    workoutPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutPlan',
      required: true,
      index: true,
    },
    workoutDay: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutDay',
      required: true,
      index: true,
    },
    /** User's local calendar date for this slot, e.g. "2026-03-28" */
    scheduledDateKey: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    /** IANA timezone used to interpret scheduledDateKey and missedAfterUtc */
    timeZone: {
      type: String,
      required: true,
      trim: true,
    },
    /** When status may flip to missed if still planned/in_progress (end of local day + 24h). */
    missedAfterUtc: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      enum: ['planned', 'in_progress', 'completed', 'missed'],
      default: 'planned',
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
  },
);

workoutDayOccurrenceSchema.index(
  { user: 1, workoutPlan: 1, workoutDay: 1, scheduledDateKey: 1 },
  { unique: true },
);
workoutDayOccurrenceSchema.index({ missedAfterUtc: 1, status: 1 });

export default mongoose.model('WorkoutDayOccurrence', workoutDayOccurrenceSchema);
