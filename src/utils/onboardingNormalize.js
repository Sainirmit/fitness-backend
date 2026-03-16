/**
 * Onboarding normalization helpers.
 * Store normalized strings (e.g. build_muscle) so frontend labels can change
 * without backend updates. Use when persisting onboarding payloads.
 */

/**
 * Normalize a label to a stored value: "Build Muscle" → "build_muscle"
 * @param {string} label - Display label from frontend
 * @returns {string} - Lowercase, spaces/special chars to underscore
 */
export function normalizeOptionValue(label) {
  if (typeof label !== 'string' || !label.trim()) return '';
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Normalize free-text home equipment into an array of strings.
 * e.g. "dumbbells, resistance bands, pull-up bar" → ["dumbbells", "resistance_bands", "pull_up_bar"]
 * @param {string} text - Raw input from user
 * @returns {string[]}
 */
export function normalizeHomeEquipment(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  return text
    .split(/[,;]/)
    .map((s) => normalizeOptionValue(s))
    .filter(Boolean);
}
