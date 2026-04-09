import { describe, it, expect } from 'vitest';
import {
  computeMissedAfterUtc,
  isValidDateKey,
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
});
