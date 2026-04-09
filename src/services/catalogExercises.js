import Exercise from '../models/Exercise.js';

/**
 * Load every active exercise for a catalog directly from MongoDB.
 * Sorted by name for deterministic exerciseIndex mapping.
 */
export async function loadCatalogExercises(catalogKey) {
  return Exercise.find({ catalogKey, isActive: true }).sort({ name: 1 }).lean();
}
