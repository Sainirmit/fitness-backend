/**
 * Strict JSON schema definition, validation, and confidence thresholds
 * for the body-photo vision analysis output.
 */

export const CONFIDENCE_THRESHOLDS = {
  MINIMUM: 0.6,
  HIGH: 0.8,
};

/**
 * Blocker quality flags that indicate the photo set cannot yield a reliable
 * analysis regardless of confidence score.
 *
 * BLOCKING conditions (any one → INVALID_PHOTOS):
 *   - fullBodyVisible = false  (body not in frame — nothing to analyze)
 *   - frontPoseCorrect = false AND sidePoseCorrect = false (both poses unusable)
 *
 * SOFT conditions (both false → still blocking together):
 *   - lightingAdequate = false  — combined with a bad pose it's unrecoverable
 *   - clothingAppropriate = false — combined with a bad pose it's unrecoverable
 *
 * @param {object} analysis  Validated analysis output from the vision model
 * @returns {{ valid: boolean, failedChecks: string[], blockers: string[], message: string }}
 */
export function validatePhotoQuality(analysis) {
  const qf = analysis?.qualityFlags ?? {};
  const failedChecks = [];

  if (qf.fullBodyVisible === false) failedChecks.push('fullBodyVisible');
  if (qf.frontPoseCorrect === false) failedChecks.push('frontPoseCorrect');
  if (qf.sidePoseCorrect === false) failedChecks.push('sidePoseCorrect');
  if (qf.lightingAdequate === false) failedChecks.push('lightingAdequate');
  if (qf.clothingAppropriate === false) failedChecks.push('clothingAppropriate');

  // Hard blockers: full body not visible, or every available pose is wrong.
  const blockers = failedChecks.filter((c) =>
    ['fullBodyVisible', 'frontPoseCorrect', 'sidePoseCorrect'].includes(c),
  );

  const bothPosesBad =
    qf.frontPoseCorrect === false && qf.sidePoseCorrect === false;
  const isBlocked = qf.fullBodyVisible === false || bothPosesBad;

  const READABLE = {
    fullBodyVisible: 'full body must be visible head-to-toe',
    frontPoseCorrect: 'front-facing pose required (face camera, arms slightly out)',
    sidePoseCorrect: 'side pose required (90° profile, full body visible)',
    lightingAdequate: 'better lighting needed',
    clothingAppropriate: 'form-fitting clothing required for accurate assessment',
  };

  const message = isBlocked
    ? `Photos could not be analyzed. Please retake: ${blockers.map((c) => READABLE[c]).join('; ')}.`
    : '';

  return { valid: !isBlocked, failedChecks, blockers, message };
}

const SEVERITY_VALUES = ['mild', 'moderate', 'significant'];
const BALANCE_VALUES = ['upper_dominant', 'lower_dominant', 'balanced'];
const AP_BALANCE_VALUES = ['anterior_dominant', 'posterior_dominant', 'balanced'];
const SYMMETRY_VALUES = ['symmetric', 'mild_asymmetry', 'notable_asymmetry'];
const COMPOSITION_CATEGORIES = ['lean', 'athletic', 'average', 'above_average', 'elevated'];

function isNumber(v) { return typeof v === 'number' && !Number.isNaN(v); }
function isString(v) { return typeof v === 'string'; }
function isBool(v) { return typeof v === 'boolean'; }
function isConfidence(v) { return isNumber(v) && v >= 0 && v <= 1; }
function isOneOf(v, arr) { return arr.includes(v); }

function validateObservation(obj, path) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return [`${path}: must be an object`];
  if (!isBool(obj.observed)) errors.push(`${path}.observed: must be boolean`);
  if (obj.observed === true) {
    if (!isOneOf(obj.severity, SEVERITY_VALUES))
      errors.push(`${path}.severity: must be one of ${SEVERITY_VALUES.join(',')}`);
  }
  if (!isConfidence(obj.confidence)) errors.push(`${path}.confidence: must be 0-1`);
  return errors;
}

/**
 * Validate the structured analysis output from the vision model.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAnalysisOutput(output) {
  const errors = [];
  if (!output || typeof output !== 'object')
    return { valid: false, errors: ['Output must be an object'] };

  // ── posture ──
  if (!output.posture || typeof output.posture !== 'object') {
    errors.push('posture: must be an object');
  } else {
    for (const key of ['forwardHead', 'roundedShoulders', 'anteriorPelvicTilt', 'lateralImbalance']) {
      errors.push(...validateObservation(output.posture[key], `posture.${key}`));
    }
  }

  // ── muscleBalance ──
  if (!output.muscleBalance || typeof output.muscleBalance !== 'object') {
    errors.push('muscleBalance: must be an object');
  } else {
    const mb = output.muscleBalance;
    if (!isOneOf(mb.upperLowerRatio, BALANCE_VALUES))
      errors.push('muscleBalance.upperLowerRatio: invalid');
    if (!isOneOf(mb.anteriorPosteriorBalance, AP_BALANCE_VALUES))
      errors.push('muscleBalance.anteriorPosteriorBalance: invalid');
    if (!isOneOf(mb.leftRightSymmetry, SYMMETRY_VALUES))
      errors.push('muscleBalance.leftRightSymmetry: invalid');
    if (!isConfidence(mb.confidence))
      errors.push('muscleBalance.confidence: must be 0-1');
  }

  // ── bodyComposition ──
  if (!output.bodyComposition || typeof output.bodyComposition !== 'object') {
    errors.push('bodyComposition: must be an object');
  } else {
    const bc = output.bodyComposition;
    if (!isOneOf(bc.category, COMPOSITION_CATEGORIES))
      errors.push('bodyComposition.category: invalid');
    if (
      !bc.estimatedBodyFatRange ||
      !isNumber(bc.estimatedBodyFatRange.min) ||
      !isNumber(bc.estimatedBodyFatRange.max)
    ) {
      errors.push('bodyComposition.estimatedBodyFatRange: must have numeric min/max');
    }
    if (!isConfidence(bc.confidence))
      errors.push('bodyComposition.confidence: must be 0-1');
  }

  // ── movementRiskFlags ──
  if (!Array.isArray(output.movementRiskFlags)) {
    errors.push('movementRiskFlags: must be an array');
  } else {
    for (let i = 0; i < output.movementRiskFlags.length; i++) {
      const flag = output.movementRiskFlags[i];
      if (!isString(flag.area)) errors.push(`movementRiskFlags[${i}].area: must be string`);
      if (!isString(flag.concern)) errors.push(`movementRiskFlags[${i}].concern: must be string`);
      if (!isString(flag.recommendation))
        errors.push(`movementRiskFlags[${i}].recommendation: must be string`);
    }
  }

  // ── top-level scalars ──
  if (!isConfidence(output.overallConfidence))
    errors.push('overallConfidence: must be 0-1');

  // ── qualityFlags ──
  if (!output.qualityFlags || typeof output.qualityFlags !== 'object') {
    errors.push('qualityFlags: must be an object');
  } else {
    for (const key of [
      'lightingAdequate',
      'fullBodyVisible',
      'clothingAppropriate',
      'frontPoseCorrect',
      'sidePoseCorrect',
    ]) {
      if (!isBool(output.qualityFlags[key]))
        errors.push(`qualityFlags.${key}: must be boolean`);
    }
  }

  if (!isString(output.summary)) errors.push('summary: must be a string');
  if (!Array.isArray(output.trainingRecommendations))
    errors.push('trainingRecommendations: must be an array');

  return { valid: errors.length === 0, errors };
}

/**
 * Reference schema object included in the vision-model prompt so it knows the
 * exact shape to return.
 */
export const ANALYSIS_OUTPUT_SCHEMA = {
  posture: {
    forwardHead: { observed: 'boolean', severity: 'mild|moderate|significant', confidence: '0-1' },
    roundedShoulders: { observed: 'boolean', severity: 'mild|moderate|significant', confidence: '0-1' },
    anteriorPelvicTilt: { observed: 'boolean', severity: 'mild|moderate|significant', confidence: '0-1' },
    lateralImbalance: { observed: 'boolean', severity: 'mild|moderate|significant', confidence: '0-1' },
  },
  muscleBalance: {
    upperLowerRatio: 'upper_dominant|lower_dominant|balanced',
    anteriorPosteriorBalance: 'anterior_dominant|posterior_dominant|balanced',
    leftRightSymmetry: 'symmetric|mild_asymmetry|notable_asymmetry',
    confidence: '0-1',
  },
  bodyComposition: {
    category: 'lean|athletic|average|above_average|elevated',
    estimatedBodyFatRange: { min: 'number', max: 'number' },
    confidence: '0-1',
  },
  movementRiskFlags: [
    { area: 'string', concern: 'string', recommendation: 'string' },
  ],
  overallConfidence: '0-1',
  qualityFlags: {
    lightingAdequate: 'boolean',
    fullBodyVisible: 'boolean',
    clothingAppropriate: 'boolean',
    frontPoseCorrect: 'boolean',
    sidePoseCorrect: 'boolean',
  },
  summary: 'string (2-4 sentences, observational only, no medical/diagnostic language)',
  trainingRecommendations: ['string (specific training focus suggestions based on observations)'],
};
