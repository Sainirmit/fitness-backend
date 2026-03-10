/**
 * Models Index - Centralized exports for all Mongoose models
 */

// Authentication & User Management
export { default as User } from './User.js';

// Workout System
export { default as Exercise } from './Exercise.js';
export { default as WorkoutPlan } from './WorkoutPlan.js';
export { default as WorkoutDay } from './WorkoutDay.js';
export { default as WorkoutDayExercise } from './WorkoutDayExercise.js';
export { default as WorkoutSession } from './WorkoutSession.js';
export { default as WorkoutSessionExercise } from './WorkoutSessionExercise.js';
export { default as WorkoutSetLog } from './WorkoutSetLog.js';

// Existing Models
export { default as BodyDetails } from './BodyDetails.js';
export { default as BodyPhotos } from './BodyPhotos.js';
export { default as MealTracker } from './MealTracker.js';
export { default as Subscription } from './Subscription.js';
