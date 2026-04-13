import { describe, it, expect } from 'vitest';
import {
  computeMissedAfterUtc,
  isValidDateKey,
  extractFeedbackFromBody,
} from '../services/workoutOccurrenceService.js';

describe('workoutOccurrenceService', () => {
  it('isValidDateKey accepts YYYY-MM-DD', () => {
    expect(isValidDateKey('2026-03-28')).toBe(true);
    expect(isValidDateKey('26-03-28')).toBe(false);
  });

  it('computeMissedAfterUtc is 24h after end of local day', () => {
    const m = computeMissedAfterUtc('2026-06-15', 'UTC');
    expect(m).toBeInstanceOf(Date);
    expect(Number.isNaN(m.getTime())).toBe(false);
  });

  describe('extractFeedbackFromBody', () => {
    it('maps durationHours and durationMinutes to totalDurationMinutes', () => {
      const { fields, error } = extractFeedbackFromBody({
        durationHours: 2,
        durationMinutes: 30,
      });
      expect(error).toBeUndefined();
      expect(fields.totalDurationMinutes).toBe(150);
    });

    it('prefers totalDurationMinutes over hours/minutes', () => {
      const { fields } = extractFeedbackFromBody({
        totalDurationMinutes: 45,
        durationHours: 9,
        durationMinutes: 0,
      });
      expect(fields.totalDurationMinutes).toBe(45);
    });

    it('parses strenuousness and energy', () => {
      const { fields, error } = extractFeedbackFromBody({
        strenuousnessRating: 'DIFFICULT',
        energyLevelRating: 4,
      });
      expect(error).toBeUndefined();
      expect(fields.strenuousnessRating).toBe('difficult');
      expect(fields.energyLevelRating).toBe(4);
    });

    it('rejects invalid strenuousness', () => {
      const { error } = extractFeedbackFromBody({
        strenuousnessRating: 'extreme',
      });
      expect(error?.status).toBe(400);
    });
  });
});
