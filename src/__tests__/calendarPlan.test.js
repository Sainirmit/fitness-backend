import { describe, it, expect } from 'vitest';
import {
  computeMissedAfterUtc,
  isValidDateKey,
} from '../services/workoutOccurrenceService.js';
import {
  computeCardState,
  weekKeysForDate,
  dayLabel,
} from '../services/homeDashboardService.js';

// ---------------------------------------------------------------------------
// Calendar schedule validation (pure logic tests)
// ---------------------------------------------------------------------------

describe('calendar schedule dateKey validation', () => {
  it('validates correct YYYY-MM-DD format', () => {
    expect(isValidDateKey('2026-03-30')).toBe(true);
    expect(isValidDateKey('2026-04-26')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(isValidDateKey('2026-3-30')).toBe(false);
    expect(isValidDateKey('03-30-2026')).toBe(false);
    expect(isValidDateKey('')).toBe(false);
    expect(isValidDateKey(null)).toBe(false);
  });
});

describe('28-day schedule structure validation', () => {
  function generate28DateKeys(startDateKey) {
    const [y, m, d] = startDateKey.split('-').map(Number);
    const keys = [];
    const cursor = new Date(Date.UTC(y, m - 1, d));
    for (let i = 0; i < 28; i++) {
      keys.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return keys;
  }

  it('generates exactly 28 unique dateKeys from a start date', () => {
    const keys = generate28DateKeys('2026-03-30');
    expect(keys).toHaveLength(28);
    const unique = new Set(keys);
    expect(unique.size).toBe(28);
  });

  it('first key matches start date', () => {
    const keys = generate28DateKeys('2026-03-30');
    expect(keys[0]).toBe('2026-03-30');
  });

  it('last key is 27 days after start', () => {
    const keys = generate28DateKeys('2026-03-30');
    expect(keys[27]).toBe('2026-04-26');
  });

  it('handles month boundary correctly', () => {
    const keys = generate28DateKeys('2026-02-15');
    expect(keys).toContain('2026-02-28');
    expect(keys).toContain('2026-03-01');
  });
});

// ---------------------------------------------------------------------------
// Rest day identification
// ---------------------------------------------------------------------------

describe('rest day flag logic', () => {
  const workoutDays = new Set(['mon', 'wed', 'fri']);

  function isRestDay(dateKey) {
    return !workoutDays.has(dayLabel(dateKey));
  }

  it('marks non-workout days as rest', () => {
    expect(isRestDay('2026-03-31')).toBe(true); // Tuesday
    expect(isRestDay('2026-04-02')).toBe(true); // Thursday
  });

  it('marks workout days as non-rest', () => {
    expect(isRestDay('2026-03-30')).toBe(false); // Monday
    expect(isRestDay('2026-04-01')).toBe(false); // Wednesday
    expect(isRestDay('2026-04-03')).toBe(false); // Friday
  });
});

// ---------------------------------------------------------------------------
// Missed cutoff for calendar days
// ---------------------------------------------------------------------------

describe('calendar day missed cutoff', () => {
  it('computes cutoff for a date-native workout day', () => {
    const cutoff = computeMissedAfterUtc('2026-04-01', 'America/New_York');
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff.getTime()).toBeGreaterThan(
      new Date('2026-04-01T23:59:59-04:00').getTime(),
    );
  });

  it('cutoff is 24h after end of local day', () => {
    const cutoff = computeMissedAfterUtc('2026-04-01', 'UTC');
    const endOfDay = new Date('2026-04-01T23:59:59.999Z');
    const expected = new Date(endOfDay.getTime() + 24 * 60 * 60 * 1000);
    expect(cutoff.getTime()).toBe(expected.getTime());
  });

  it('respects timezone offset', () => {
    const utcCutoff = computeMissedAfterUtc('2026-04-01', 'UTC');
    const nyCutoff = computeMissedAfterUtc('2026-04-01', 'America/New_York');
    expect(nyCutoff.getTime()).not.toBe(utcCutoff.getTime());
  });
});

// ---------------------------------------------------------------------------
// Card state with calendar-native status
// ---------------------------------------------------------------------------

describe('computeCardState with calendar day status', () => {
  const today = '2026-03-30';

  it('today rest day (isRestDay true → status null)', () => {
    expect(computeCardState('2026-03-30', today, null)).toBe('today_rest');
  });

  it('today planned workout', () => {
    expect(computeCardState('2026-03-30', today, 'planned')).toBe('today_planned');
  });

  it('today in_progress workout', () => {
    expect(computeCardState('2026-03-30', today, 'in_progress')).toBe('today_in_progress');
  });

  it('today completed workout', () => {
    expect(computeCardState('2026-03-30', today, 'completed')).toBe('today_completed');
  });

  it('past completed', () => {
    expect(computeCardState('2026-03-29', today, 'completed')).toBe('past_completed');
  });

  it('past missed', () => {
    expect(computeCardState('2026-03-29', today, 'missed')).toBe('past_missed');
  });

  it('past rest', () => {
    expect(computeCardState('2026-03-29', today, null)).toBe('past_rest');
  });

  it('future', () => {
    expect(computeCardState('2026-04-01', today, 'planned')).toBe('future');
    expect(computeCardState('2026-04-01', today, null)).toBe('future');
  });
});

// ---------------------------------------------------------------------------
// Week window for date range queries
// ---------------------------------------------------------------------------

describe('weekKeysForDate for calendar plans', () => {
  it('returns Mon–Sun window containing any date', () => {
    const keys = weekKeysForDate('2026-03-30'); // Monday
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe('2026-03-30'); // Monday
    expect(keys[6]).toBe('2026-04-05'); // Sunday
  });

  it('works for a mid-week date', () => {
    const keys = weekKeysForDate('2026-04-01'); // Wednesday
    expect(keys[0]).toBe('2026-03-30');
    expect(keys[6]).toBe('2026-04-05');
  });

  it('works for a Sunday', () => {
    const keys = weekKeysForDate('2026-04-05'); // Sunday
    expect(keys[0]).toBe('2026-03-30');
    expect(keys[6]).toBe('2026-04-05');
  });
});

// ---------------------------------------------------------------------------
// dateKey uniqueness within a plan
// ---------------------------------------------------------------------------

describe('dateKey uniqueness constraint', () => {
  it('28 sequential dates are all unique', () => {
    const start = new Date(Date.UTC(2026, 2, 30)); // 2026-03-30
    const keys = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      keys.push(d.toISOString().slice(0, 10));
    }
    expect(new Set(keys).size).toBe(28);
  });
});
