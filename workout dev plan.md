# Workout – Development Plan & Data Models

This document describes the workout-related data models and flow for the fitness backend (MongoDB + Mongoose). It supports: AI-generated workout plans (post-payment), an exercise bank with videos (AWS), and full tracking (strength, bodyweight, cardio) plus session feedback.

---

## 1. Model Overview

| Model | Purpose |
|-------|--------|
| **Exercise** | Exercise bank (catalog). AI selects from here when building plans. Each exercise has a video (AWS). |
| **WorkoutPlan** | One AI-generated plan per user (or per version). Created after payment using onboarding data. |
| **WorkoutDay** | One “day” in a plan (e.g. Day 1: Chest & Triceps), with estimated duration and pro tip. |
| **WorkoutDayExercise** | Planned exercise within a day: links Exercise to WorkoutDay with sets/reps/rest or duration/speed/incline. |
| **WorkoutSession** | One tracked workout instance (user started and optionally completed or discarded a WorkoutDay). |
| **WorkoutSessionExercise** | Exercise within a session; links session to the planned WorkoutDayExercise. |
| **WorkoutSetLog** | Per-set (or per-cardio block) log: reps, weight, duration, completion. |

**User** can optionally have a `currentWorkoutPlan` reference for quick “My Plan” resolution; otherwise current plan is derived by querying `WorkoutPlan` by user and status.

---

## 2. Exercise (Exercise Bank)

**Collection:** `exercises`  
**Purpose:** Master catalog of exercises. AI uses this bank to build plans. Each exercise has an associated video (stored in AWS).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | String | Yes | Display name (e.g. "Barbell Chest Press Incline", "Treadmill") |
| `description` | String | No | Instructions / steps for the exercise modal |
| `videoUrl` | String | Yes | S3 or CDN URL for the demo video |
| `thumbnailUrl` | String | No | Optional thumbnail for lists/cards |
| `exerciseType` | String | Yes | `'strength'` \| `'cardio'` \| `'bodyweight'` |
| `muscleGroups` | [String] | No | e.g. `["chest", "triceps"]` |
| `equipment` | [String] | No | e.g. `["barbell", "bench"]` |
| `difficultyLevel` | String | No | e.g. `'beginner'` \| `'intermediate'` \| `'advanced'` |
| `defaultSets` | Number | No | Default number of sets |
| `defaultRepMin` | Number | No | Default min reps (strength/bodyweight) |
| `defaultRepMax` | Number | No | Default max reps (strength/bodyweight) |
| `defaultRestSeconds` | Number | No | Default rest between sets (seconds) |
| `defaultDurationMinutes` | Number | No | Default duration for cardio |
| `defaultSpeed` | Number | No | Default speed (cardio) |
| `defaultIncline` | Number | No | Default incline (cardio) |
| `isActive` | Boolean | No | Default `true`; set false to hide from catalog |

**Indexes:** `exerciseType`, `isActive`, optionally `muscleGroups` / `equipment` for filtering.

---

## 3. WorkoutPlan

**Collection:** `workoutplans`  
**Purpose:** One AI-generated plan per user (or per generation). Created after payment when OpenAI is called with onboarding data.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user` | ObjectId ref User | Yes | Owner of the plan |
| `name` | String | No | e.g. "My Workout Plan" |
| `status` | String | Yes | `'pending_generation'` \| `'active'` \| `'completed'` \| `'archived'` |
| `generatedAt` | Date | No | When the AI plan was created |
| `onboardingSnapshot` | Object | No | Snapshot of onboarding data sent to OpenAI (audit/re-run) |
| `startDate` | Date | No | Plan start date |
| `endDate` | Date | No | Plan end date |
| `metadata` | Object | No | Extra AI/provider metadata |

**Indexes:** `user`, `user + status`, `generatedAt`.

---

## 4. WorkoutDay

**Collection:** `workoutdays`  
**Purpose:** One “day” in a plan (e.g. "Day 1: Chest & Triceps"), with estimated duration, exercise count, and pro tip.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workoutPlan` | ObjectId ref WorkoutPlan | Yes | Parent plan |
| `dayNumber` | Number | Yes | 1, 2, 3, … |
| `name` | String | No | e.g. "Chest & Triceps", "Delts & Core" |
| `estimatedDurationMinutes` | Number | No | e.g. 85 for "1h 25m" |
| `exerciseCount` | Number | No | Denormalized count for list UI |
| `iconIdentifier` | String | No | e.g. `"chest_triceps"` for UI asset |
| `proTip` | String | No | Pro tip for that day |
| `status` | String | No | e.g. `'planned'` \| `'completed'` |

**Indexes:** `workoutPlan`, `workoutPlan + dayNumber` (unique).

---

## 5. WorkoutDayExercise

**Collection:** `workoutdayexercises`  
**Purpose:** Links an exercise from the bank to a workout day with prescribed sets, reps, rest, or duration/speed/incline. Supports special instructions (e.g. "Dropset last 2").

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workoutDay` | ObjectId ref WorkoutDay | Yes | Parent day |
| `exercise` | ObjectId ref Exercise | Yes | From exercise bank |
| `orderInDay` | Number | Yes | 1, 2, 3, … (order in the day; progress dots) |
| `prescribedSets` | Number | No | e.g. 4 |
| `prescribedRepMin` | Number | No | e.g. 8 |
| `prescribedRepMax` | Number | No | e.g. 10 |
| `prescribedRestSeconds` | Number | No | e.g. 60 |
| `prescribedDurationMinutes` | Number | No | Cardio target |
| `prescribedSpeed` | Number | No | Cardio |
| `prescribedIncline` | Number | No | Cardio |
| `specialInstructions` | String | No | e.g. "Dropset last 2" |
| `setType` | String | No | e.g. `'warmup'` \| `'main'` |

**Indexes:** `workoutDay`, `workoutDay + orderInDay`.

---

## 6. WorkoutSession

**Collection:** `workoutsessions`  
**Purpose:** One instance of a user performing a workout (a specific WorkoutDay). Tracks in-progress, completed, or discarded, plus post-workout feedback.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user` | ObjectId ref User | Yes | Who performed the workout |
| `workoutDay` | ObjectId ref WorkoutDay | Yes | Which day was performed |
| `workoutPlan` | ObjectId ref WorkoutPlan | No | Denormalized for queries |
| `status` | String | Yes | `'in_progress'` \| `'completed'` \| `'discarded'` |
| `startedAt` | Date | Yes | When the user started (after countdown) |
| `completedAt` | Date | No | When "Finish" was pressed |
| `totalDurationMinutes` | Number | No | "How long was your workout?" (e.g. 150 for 2h 30m) |
| `strenuousnessRating` | String | No | `'light'` \| `'moderate'` \| `'difficult'` |
| `energyLevelRating` | Number | No | 1–5, "How was your energy?" |

**Indexes:** `user`, `user + startedAt`, `workoutDay`, `status`.

---

## 7. WorkoutSessionExercise

**Collection:** `workoutsessionexercises`  
**Purpose:** Links a workout session to each planned exercise so we know order and can attach set logs. Prescribed parameters come from WorkoutDayExercise (and Exercise).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workoutSession` | ObjectId ref WorkoutSession | Yes | Parent session |
| `workoutDayExercise` | ObjectId ref WorkoutDayExercise | Yes | Planned exercise (has ref to Exercise + prescribed params) |
| `orderInSession` | Number | Yes | 1, 2, … (matches UI order) |

**Indexes:** `workoutSession`, `workoutSession + orderInSession`.

---

## 8. WorkoutSetLog

**Collection:** `workoutsetlogs`  
**Purpose:** Per-set (or per-cardio block) log. Supports strength (reps ± weight), bodyweight (reps only), and cardio (duration, speed, incline).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workoutSessionExercise` | ObjectId ref WorkoutSessionExercise | Yes | Which exercise in this session |
| `setNumber` | Number | Yes | 1, 2, 3, 4, … |
| `recordedReps` | Number | No | Strength/bodyweight |
| `recordedWeight` | Number | No | Strength only |
| `weightUnit` | String | No | `'lbs'` \| `'kg'` |
| `recordedDurationMinutes` | Number | No | Cardio |
| `recordedSpeed` | Number | No | Cardio |
| `recordedIncline` | Number | No | Cardio |
| `isCompleted` | Boolean | No | Checkbox "Completed" |
| `loggedAt` | Date | No | When the set was logged |

**Indexes:** `workoutSessionExercise`, `workoutSessionExercise + setNumber` (unique per session exercise).

---

## 9. User (Optional Extension)

- **Optional:** Add `currentWorkoutPlan` (ObjectId ref WorkoutPlan) on the User model so the app can resolve "My Workout Plan" without an extra query.
- **Alternative:** Derive current plan with `WorkoutPlan.findOne({ user, status: 'active' }).sort({ generatedAt: -1 })`.

---

## 10. Flow Summary

1. **Onboarding** → Stored on **User** (existing).
2. **Payment** → Subscription (existing). After payment, backend calls OpenAI with onboarding data and creates **WorkoutPlan** plus **WorkoutDay** and **WorkoutDayExercise** entries (referencing **Exercise** ids from the bank).
3. **App loads plan** → **WorkoutPlan** → **WorkoutDay** list → **WorkoutDayExercise** (+ **Exercise** for name, video, instructions).
4. **Start workout** → Create **WorkoutSession** (`in_progress`), create **WorkoutSessionExercise** for each **WorkoutDayExercise**.
5. **Log sets** → Create/update **WorkoutSetLog** (reps/weight or duration/speed/incline by exercise type).
6. **Finish / Discard** → Update **WorkoutSession**: set `completedAt`, `totalDurationMinutes`, `strenuousnessRating`, `energyLevelRating`; set `status` to `'completed'` or `'discarded'`.

---

## 11. MVP Implementation Notes

- **Backend:** Workout service that creates plans from OpenAI response, starts/completes/discards sessions, and writes set logs.
- **OpenAI:** Dedicated module that accepts onboarding snapshot, calls API, and maps response to WorkoutPlan / WorkoutDay / WorkoutDayExercise (using existing Exercise ids).
- **Videos:** Stored in AWS S3; only URLs (and optional thumbnail) stored in **Exercise**; serve via CDN or pre-signed URLs as needed.
- **Idempotency:** When creating a plan from OpenAI, gate on a single “generation” flow (e.g. by user + `status: 'pending_generation'`) to avoid duplicate plans on double submission.
