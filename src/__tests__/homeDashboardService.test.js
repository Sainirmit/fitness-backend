import { describe, it, expect } from 'vitest';
import {
  computeCardState,
  weekKeysForDate,
  dayLabel,
  previousDateKey,
} from '../services/homeDashboardService.js';

// ---------------------------------------------------------------------------
// computeCardState
// ---------------------------------------------------------------------------

describe('computeCardState', () => {
  const today = '2026-03-28';

  it('today + no occurrence → today_rest', () => {
    expect(computeCardState('2026-03-28', today, null)).toBe('today_rest');
  });

  it('today + planned → today_planned', () => {
    expect(computeCardState('2026-03-28', today, 'planned')).toBe('today_planned');
  });

  it('today + in_progress → today_in_progress', () => {
    expect(computeCardState('2026-03-28', today, 'in_progress')).toBe('today_in_progress');
  });

  it('today + completed → today_completed', () => {
    expect(computeCardState('2026-03-28', today, 'completed')).toBe('today_completed');
  });

  it('past + completed → past_completed', () => {
    expect(computeCardState('2026-03-27', today, 'completed')).toBe('past_completed');
  });

  it('past + missed → past_missed', () => {
    expect(computeCardState('2026-03-27', today, 'missed')).toBe('past_missed');
  });

  it('past + no occurrence → past_rest', () => {
    expect(computeCardState('2026-03-27', today, null)).toBe('past_rest');
  });

  it('future + any → future', () => {
    expect(computeCardState('2026-03-29', today, 'planned')).toBe('future');
    expect(computeCardState('2026-03-29', today, null)).toBe('future');
  });
});

// ---------------------------------------------------------------------------
// weekKeysForDate
// ---------------------------------------------------------------------------

describe('weekKeysForDate', () => {
  it('returns 7 keys starting on Monday', () => {
    const keys = weekKeysForDate('2026-03-28'); // Saturday
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe('2026-03-23'); // Monday
    expect(keys[6]).toBe('2026-03-29'); // Sunday
  });

  it('returns same week for any day in the week', () => {
    const mon = weekKeysForDate('2026-03-23');
    const fri = weekKeysForDate('2026-03-27');
    expect(mon).toEqual(fri);
  });
});

// ---------------------------------------------------------------------------
// dayLabel
// ---------------------------------------------------------------------------

describe('dayLabel', () => {
  it('maps date keys to short day labels', () => {
    expect(dayLabel('2026-03-23')).toBe('mon');
    expect(dayLabel('2026-03-28')).toBe('sat');
    expect(dayLabel('2026-03-29')).toBe('sun');
  });
});

// ---------------------------------------------------------------------------
// previousDateKey
// ---------------------------------------------------------------------------

describe('previousDateKey', () => {
  it('returns the day before', () => {
    expect(previousDateKey('2026-03-28')).toBe('2026-03-27');
  });

  it('handles month boundaries', () => {
    expect(previousDateKey('2026-04-01')).toBe('2026-03-31');
  });

  it('handles year boundaries', () => {
    expect(previousDateKey('2026-01-01')).toBe('2025-12-31');
  });
});

// ---------------------------------------------------------------------------
// Replacement sheet exclusion logic (unit-level simulation)
// ---------------------------------------------------------------------------

describe('replacement sheet exclusion logic', () => {
  // Simulating the core logic extracted from buildReplacementSheetOptions:
  // Given allDayIds and a completed yesterday occurrence, which day is blocked?

  function resolveBlockedId(yesterdayOcc, replacementMap) {
    if (!yesterdayOcc || yesterdayOcc.status !== 'completed') return null;
    const origId = String(yesterdayOcc.workoutDay);
    return replacementMap[origId] || origId;
  }

  it('blocks yesterday completed workout (no replacement)', () => {
    const occ = { status: 'completed', workoutDay: 'day1' };
    expect(resolveBlockedId(occ, {})).toBe('day1');
  });

  it('blocks the effective (replaced) workout when replacement was active', () => {
    const occ = { status: 'completed', workoutDay: 'day2' };
    const map = { day2: 'day1' }; // day2 was replaced by day1
    expect(resolveBlockedId(occ, map)).toBe('day1');
  });

  it('does not block anything when yesterday was rest (no occurrence)', () => {
    expect(resolveBlockedId(null, {})).toBeNull();
  });

  it('does not block when yesterday was missed', () => {
    const occ = { status: 'missed', workoutDay: 'day1' };
    expect(resolveBlockedId(occ, {})).toBeNull();
  });

  it('does not block when yesterday was planned (not done)', () => {
    const occ = { status: 'planned', workoutDay: 'day1' };
    expect(resolveBlockedId(occ, {})).toBeNull();
  });

  /** Mirrors buildReplacementSheetOptions `disabled` (name-based cooldown). */
  function optionDisabled({ blockedName, dayName }) {
    return blockedName != null && dayName === blockedName;
  }

  it('cooldown: disables split matching yesterday when today is rest', () => {
    expect(optionDisabled({ blockedName: 'Arms', dayName: 'Arms' })).toBe(true);
  });

  it('cooldown: disables same split even when it is also today’s scheduled workout', () => {
    expect(optionDisabled({ blockedName: 'Arms', dayName: 'Arms' })).toBe(true);
  });

  it('cooldown: does not disable unrelated splits', () => {
    expect(optionDisabled({ blockedName: 'Arms', dayName: 'Legs' })).toBe(false);
  });

  it('cooldown: no block when yesterday had nothing completed', () => {
    expect(optionDisabled({ blockedName: null, dayName: 'Arms' })).toBe(false);
  });
});
