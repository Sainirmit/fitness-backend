import { describe, it, expect } from 'vitest';
import {
  validateAnalysisOutput,
  CONFIDENCE_THRESHOLDS,
} from '../services/bodyPhotoAnalysisSchema.js';

function makeValidAnalysis(overrides = {}) {
  return {
    posture: {
      forwardHead: { observed: false, severity: 'mild', confidence: 0.7 },
      roundedShoulders: { observed: true, severity: 'moderate', confidence: 0.8 },
      anteriorPelvicTilt: { observed: false, severity: 'mild', confidence: 0.6 },
      lateralImbalance: { observed: false, severity: 'mild', confidence: 0.7 },
    },
    muscleBalance: {
      upperLowerRatio: 'balanced',
      anteriorPosteriorBalance: 'anterior_dominant',
      leftRightSymmetry: 'symmetric',
      confidence: 0.75,
    },
    bodyComposition: {
      category: 'athletic',
      estimatedBodyFatRange: { min: 12, max: 18 },
      confidence: 0.7,
    },
    movementRiskFlags: [
      { area: 'shoulders', concern: 'rounded posture', recommendation: 'add face pulls' },
    ],
    overallConfidence: 0.75,
    qualityFlags: {
      lightingAdequate: true,
      fullBodyVisible: true,
      clothingAppropriate: true,
      frontPoseCorrect: true,
      sidePoseCorrect: true,
    },
    summary: 'Athletic build with minor shoulder rounding.',
    trainingRecommendations: ['Add posterior chain work'],
    ...overrides,
  };
}

describe('bodyPhotoAnalysisSchema', () => {
  describe('validateAnalysisOutput', () => {
    it('accepts a fully valid analysis output', () => {
      const result = validateAnalysisOutput(makeValidAnalysis());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects null input', () => {
      const result = validateAnalysisOutput(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Output must be an object');
    });

    it('rejects undefined input', () => {
      const result = validateAnalysisOutput(undefined);
      expect(result.valid).toBe(false);
    });

    it('rejects a string instead of object', () => {
      const result = validateAnalysisOutput('not an object');
      expect(result.valid).toBe(false);
    });

    // ── posture ──

    it('rejects missing posture object', () => {
      const analysis = makeValidAnalysis();
      delete analysis.posture;
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('posture'))).toBe(true);
    });

    it('rejects non-object posture', () => {
      const analysis = makeValidAnalysis();
      analysis.posture = 'bad';
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid severity when observed is true', () => {
      const analysis = makeValidAnalysis();
      analysis.posture.roundedShoulders = { observed: true, severity: 'extreme', confidence: 0.8 };
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('severity'))).toBe(true);
    });

    it('does not require valid severity when observed is false', () => {
      const analysis = makeValidAnalysis();
      analysis.posture.forwardHead = { observed: false, confidence: 0.7 };
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(true);
    });

    it('rejects non-boolean observed', () => {
      const analysis = makeValidAnalysis();
      analysis.posture.forwardHead = { observed: 'yes', confidence: 0.7 };
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('rejects missing confidence on observation', () => {
      const analysis = makeValidAnalysis();
      analysis.posture.forwardHead = { observed: false };
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
    });

    // ── muscleBalance ──

    it('rejects invalid upperLowerRatio', () => {
      const analysis = makeValidAnalysis();
      analysis.muscleBalance.upperLowerRatio = 'huge';
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid anteriorPosteriorBalance', () => {
      const analysis = makeValidAnalysis();
      analysis.muscleBalance.anteriorPosteriorBalance = 'left';
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('rejects invalid leftRightSymmetry', () => {
      const analysis = makeValidAnalysis();
      analysis.muscleBalance.leftRightSymmetry = 'broken';
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    // ── bodyComposition ──

    it('rejects invalid composition category', () => {
      const analysis = makeValidAnalysis();
      analysis.bodyComposition.category = 'obese';
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('rejects missing estimatedBodyFatRange', () => {
      const analysis = makeValidAnalysis();
      delete analysis.bodyComposition.estimatedBodyFatRange;
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('rejects non-numeric body fat range values', () => {
      const analysis = makeValidAnalysis();
      analysis.bodyComposition.estimatedBodyFatRange = { min: 'low', max: 'high' };
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    // ── movementRiskFlags ──

    it('accepts empty movementRiskFlags array', () => {
      const analysis = makeValidAnalysis();
      analysis.movementRiskFlags = [];
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(true);
    });

    it('rejects non-array movementRiskFlags', () => {
      const analysis = makeValidAnalysis();
      analysis.movementRiskFlags = 'not an array';
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('rejects flag entries missing required fields', () => {
      const analysis = makeValidAnalysis();
      analysis.movementRiskFlags = [{ area: 'shoulders' }];
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    // ── overallConfidence ──

    it('rejects overallConfidence > 1', () => {
      const analysis = makeValidAnalysis();
      analysis.overallConfidence = 1.5;
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('overallConfidence'))).toBe(true);
    });

    it('rejects negative overallConfidence', () => {
      const analysis = makeValidAnalysis();
      analysis.overallConfidence = -0.1;
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('accepts overallConfidence at boundaries (0 and 1)', () => {
      let analysis = makeValidAnalysis({ overallConfidence: 0 });
      expect(validateAnalysisOutput(analysis).valid).toBe(true);

      analysis = makeValidAnalysis({ overallConfidence: 1 });
      expect(validateAnalysisOutput(analysis).valid).toBe(true);
    });

    // ── qualityFlags ──

    it('rejects missing qualityFlags', () => {
      const analysis = makeValidAnalysis();
      delete analysis.qualityFlags;
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('rejects non-boolean quality flag values', () => {
      const analysis = makeValidAnalysis();
      analysis.qualityFlags.lightingAdequate = 'yes';
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    // ── summary + trainingRecommendations ──

    it('rejects non-string summary', () => {
      const analysis = makeValidAnalysis();
      analysis.summary = 123;
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('rejects non-array trainingRecommendations', () => {
      const analysis = makeValidAnalysis();
      analysis.trainingRecommendations = 'do pushups';
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
    });

    it('accepts empty trainingRecommendations array', () => {
      const analysis = makeValidAnalysis();
      analysis.trainingRecommendations = [];
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(true);
    });

    // ── multiple errors ──

    it('collects multiple errors at once', () => {
      const analysis = makeValidAnalysis();
      delete analysis.posture;
      delete analysis.muscleBalance;
      analysis.overallConfidence = 2;
      const result = validateAnalysisOutput(analysis);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('CONFIDENCE_THRESHOLDS', () => {
    it('has MINIMUM at 0.6', () => {
      expect(CONFIDENCE_THRESHOLDS.MINIMUM).toBe(0.6);
    });

    it('has HIGH at 0.8', () => {
      expect(CONFIDENCE_THRESHOLDS.HIGH).toBe(0.8);
    });

    it('MINIMUM is strictly less than HIGH', () => {
      expect(CONFIDENCE_THRESHOLDS.MINIMUM).toBeLessThan(CONFIDENCE_THRESHOLDS.HIGH);
    });
  });
});
