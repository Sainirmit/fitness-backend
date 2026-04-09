/**
 * Derives the exercise catalog key from user gender + workout environment.
 *
 * The four fixed catalogs:
 *   male_gym, male_home, female_gym, female_home
 *
 * "other" gender defaults to male catalogs (broadest exercise pool).
 */

const VALID_KEYS = new Set(['male_gym', 'male_home', 'female_gym', 'female_home']);

export function deriveCatalogKey(gender, workoutEnvironment) {
  const g = (gender || '').toLowerCase();
  const env = (workoutEnvironment || '').toLowerCase();

  const genderPrefix = g === 'female' ? 'female' : 'male';
  const envSuffix = env === 'home' ? 'home' : 'gym';

  const key = `${genderPrefix}_${envSuffix}`;
  if (!VALID_KEYS.has(key)) return 'male_gym';
  return key;
}
