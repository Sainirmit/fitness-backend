# Workout System Models Documentation

## Overview

This document describes all workout-related Mongoose models for the fitness backend system.

---

## Models Created

### 1. Exercise (`exercises` collection)
**Purpose:** Master catalog of exercises with videos and default parameters.

**Key Features:**
- Supports strength, cardio, and bodyweight exercises
- Video URLs (AWS S3) and thumbnails
- Default parameters for sets, reps, rest, duration
- Muscle groups and equipment filtering
- Search capabilities on name and description

**Indexes:**
- `exerciseType` - Filter by exercise type
- `isActive` - Show/hide exercises
- `muscleGroups` - Filter by target muscles
- `equipment` - Filter by available equipment
- Text search on `name` and `description`

---

### 2. WorkoutPlan (`workoutplans` collection)
**Purpose:** AI-generated workout plans per user.

**Key Features:**
- Status tracking (pending → active → completed → archived)
- Onboarding data snapshot for AI reference
- Plan duration (start/end dates)
- Metadata for AI generation details

**Indexes:**
- `user + status + generatedAt` - Find user's active plan
- `user` - All user plans
- `status` - Filter by status

---

### 3. WorkoutDay (`workoutdays` collection)
**Purpose:** Individual workout days within a plan.

**Key Features:**
- Ordered days (1, 2, 3...)
- Estimated duration and exercise count
- Pro tips and UI icon identifiers
- Status tracking (planned → completed → skipped)

**Indexes:**
- `workoutPlan + dayNumber` - Unique constraint
- `workoutPlan` - All days in a plan

---

### 4. WorkoutDayExercise (`workoutdayexercises` collection)
**Purpose:** Links exercises to workout days with prescribed parameters.

**Key Features:**
- Order within workout day
- Prescribed sets, reps, rest for strength
- Prescribed duration, speed, incline for cardio
- Special instructions (dropsets, supersets)
- Exercise type categorization (warmup, main, cooldown)

**Indexes:**
- `workoutDay + orderInDay` - Unique constraint
- `workoutDay` - All exercises in a day
- `exercise` - Find where exercise is used

---

### 5. WorkoutSession (`workoutsessions` collection)
**Purpose:** Tracks actual workout instances performed by users.

**Key Features:**
- Session status (in_progress → completed → discarded)
- Start and completion timestamps
- User feedback (strenuousness, energy level)
- Total duration tracking

**Indexes:**
- `user + startedAt` - User's workout history
- `workoutDay` - Sessions for a specific day
- `status` - Filter by session status

---

### 6. WorkoutSessionExercise (`workoutsessionexercises` collection)
**Purpose:** Links workout sessions to planned exercises.

**Key Features:**
- Maintains exercise order during session
- Connects to planned exercise (prescribed params)
- Enables set logging per exercise

**Indexes:**
- `workoutSession + orderInSession` - Unique constraint
- `workoutSession` - All exercises in session
- `workoutDayExercise` - Session history for specific exercise

---

### 7. WorkoutSetLog (`workoutsetlogs` collection)
**Purpose:** Per-set or per-cardio block logging.

**Key Features:**
- Strength logging: reps + weight + unit
- Bodyweight logging: reps only
- Cardio logging: duration + speed + incline
- Completion tracking and timestamps

**Indexes:**
- `workoutSessionExercise + setNumber` - Unique constraint
- `workoutSessionExercise` - All sets for exercise
- `loggedAt` - Chronological order

---

## User Model Extension

### Updated User Model
Added `currentWorkoutPlan` field:
- Type: ObjectId ref WorkoutPlan
- Purpose: Quick reference to user's active plan
- Alternative: Query WorkoutPlan for user with 'active' status

---

## Best Practices Implemented

### 1. Schema Design
- **Consistent field naming** (camelCase)
- **Proper data types** with validation
- **Default values** where appropriate
- **Enum constraints** for controlled vocabularies
- **Required fields** clearly marked

### 2. Indexing Strategy
- **Compound indexes** for common query patterns
- **Unique constraints** where needed
- **Query performance** optimization
- **Covering indexes** for frequent lookups

### 3. Data Integrity
- **Referential integrity** via ObjectId refs
- **Validation rules** (min, max, enum)
- **Transform functions** for clean JSON output
- **Timestamp tracking** for all records

### 4. Security & Performance
- **No sensitive data exposure** in JSON transforms
- **Virtuals disabled** for performance
- **Lean documents** (removed `__v`)
- **Efficient queries** through proper indexing

---

## Usage Examples

### Creating a Workout Plan
```javascript
import { WorkoutPlan, WorkoutDay, WorkoutDayExercise } from '../models';

const plan = await WorkoutPlan.create({
  user: userId,
  status: 'active',
  onboardingSnapshot: userOnboardingData
});

const day = await WorkoutDay.create({
  workoutPlan: plan._id,
  dayNumber: 1,
  name: 'Chest & Triceps',
  estimatedDurationMinutes: 85
});

await WorkoutDayExercise.create({
  workoutDay: day._id,
  exercise: exerciseId,
  orderInDay: 1,
  prescribedSets: 4,
  prescribedRepMin: 8,
  prescribedRepMax: 12
});
```

### Starting a Workout Session
```javascript
import { WorkoutSession, WorkoutSessionExercise } from '../models';

const session = await WorkoutSession.create({
  user: userId,
  workoutDay: workoutDayId,
  status: 'in_progress'
});

const sessionExercises = await WorkoutDayExercise.find({ workoutDay: workoutDayId })
  .sort({ orderInDay: 1 });

await WorkoutSessionExercise.insertMany(
  sessionExercises.map((ex, index) => ({
    workoutSession: session._id,
    workoutDayExercise: ex._id,
    orderInSession: index + 1
  }))
);
```

### Logging Workout Sets
```javascript
import { WorkoutSetLog } from '../models';

await WorkoutSetLog.create({
  workoutSessionExercise: sessionExerciseId,
  setNumber: 1,
  recordedReps: 10,
  recordedWeight: 135,
  weightUnit: 'lbs',
  isCompleted: true
});
```

---

## Migration Notes

When deploying these models:

1. **Create indexes** after collection creation
2. **Populate references** in development for testing
3. **Set up validation** for data integrity
4. **Monitor performance** with query analysis
5. **Consider sharding** for large-scale deployments

---

## Next Steps

1. **Controllers** for each model
2. **Routes** for API endpoints
3. **Services** for business logic
4. **OpenAI integration** for plan generation
5. **Video upload** handling for exercises
