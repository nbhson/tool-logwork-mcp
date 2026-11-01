import {
  isIsoDateString,
  isValidCalendarDate,
  formatIsoDateInTz,
  todayInTz,
  assertValidTimezone,
  weekStartIso,
  weekRangeIso,
  daysBetween,
  eachDayIso,
  addDaysIso,
} from '../../src/utils/date.js';
import { describe, expect, it, vi } from 'vitest';

describe('isIsoDateString / isValidCalendarDate', () => {
  it('accepts valid dates', () => {
    expect(isValidCalendarDate('2026-10-28')).toBe(true);
    expect(isValidCalendarDate('2026-01-01')).toBe(true);
    expect(isValidCalendarDate('2028-02-29')).toBe(true); // 2028 is a leap year
  });

  it('rejects invalid calendar dates', () => {
    expect(isValidCalendarDate('2026-02-30')).toBe(false);
    expect(isValidCalendarDate('2026-04-31')).toBe(false);
  });

  it('rejects format errors', () => {
    expect(isIsoDateString('2026/10/28')).toBe(false);
    expect(isIsoDateString('28-10-2026')).toBe(false);
    expect(isIsoDateString('2026-1-2')).toBe(false);
  });

  it('accepts ISO pattern even if invalid calendar date (refinement applies)', () => {
    expect(isIsoDateString('2026-13-01')).toBe(false); // month 13 caught by refine
    expect(isIsoDateString('2026-00-01')).toBe(false); // month 0 caught by refine
  });
});

describe('weekStartIso / weekRangeIso', () => {
  it('finds Monday of the week', () => {
    // 2026-10-28 is a Wednesday
    expect(weekStartIso('2026-10-28')).toBe('2026-10-26'); // Monday
    // 2026-10-26 is a Monday
    expect(weekStartIso('2026-10-26')).toBe('2026-10-26');
  });

  it('weekRange returns Mon..Sun', () => {
    const { start, end } = weekRangeIso('2026-10-28');
    expect(start).toBe('2026-10-26');
    expect(end).toBe('2026-11-01');
    expect(daysBetween(start, end)).toBe(6);
  });

  it('a SUNDAY belongs to the previous Monday-started week', () => {
    // 2026-11-01 is a Sunday: it closes the week that started Mon 2026-10-26.
    expect(weekStartIso('2026-11-01')).toBe('2026-10-26');
    expect(weekRangeIso('2026-11-01')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
  });

  it('a SATURDAY stays inside its own week', () => {
    // 2026-10-31 is a Saturday.
    expect(weekStartIso('2026-10-31')).toBe('2026-10-26');
  });

  it('spans the year boundary (2027-01-01 is a Friday)', () => {
    expect(weekRangeIso('2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });
});

describe('formatIsoDateInTz / todayInTz', () => {
  // 23:30 UTC on Sunday 2026-11-01 is already Monday 2026-11-02 in UTC+7..+11,
  // and still Sunday in UTC and UTC-10.
  const sundayNightUtc = new Date('2026-11-01T23:30:00Z');

  it('formats the same instant differently per timezone', () => {
    expect(formatIsoDateInTz(sundayNightUtc, 'UTC')).toBe('2026-11-01');
    expect(formatIsoDateInTz(sundayNightUtc, 'Asia/Ho_Chi_Minh')).toBe('2026-11-02'); // +7
    expect(formatIsoDateInTz(sundayNightUtc, 'Asia/Tokyo')).toBe('2026-11-02'); // +9
    expect(formatIsoDateInTz(sundayNightUtc, 'Australia/Sydney')).toBe('2026-11-02'); // +11 (AEDT)
    expect(formatIsoDateInTz(sundayNightUtc, 'Pacific/Honolulu')).toBe('2026-11-01'); // -10
    expect(formatIsoDateInTz(sundayNightUtc, 'America/Los_Angeles')).toBe('2026-11-01'); // -8 (PDT)
  });

  it('todayInTz resolves the current date in the configured timezone', () => {
    vi.useFakeTimers({ now: sundayNightUtc });
    try {
      expect(todayInTz('UTC')).toBe('2026-11-01');
      expect(todayInTz('Asia/Ho_Chi_Minh')).toBe('2026-11-02');
      expect(todayInTz('Asia/Tokyo')).toBe('2026-11-02');
      expect(todayInTz('Australia/Sydney')).toBe('2026-11-02');
      expect(todayInTz('Pacific/Honolulu')).toBe('2026-11-01');
    } finally {
      vi.useRealTimers();
    }
  });

  it('assertValidTimezone accepts IANA names and rejects unknown ones', () => {
    expect(() => assertValidTimezone('Asia/Ho_Chi_Minh')).not.toThrow();
    expect(() => assertValidTimezone('UTC')).not.toThrow();
    expect(() => assertValidTimezone('Not/AZone')).toThrow(/Unknown timezone/);
  });
});

describe('daysBetween', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-10-28', '2026-10-28')).toBe(0);
    expect(daysBetween('2026-10-28', '2026-10-31')).toBe(3);
    expect(daysBetween('2026-10-26', '2026-11-01')).toBe(6);
  });
});

describe('addDaysIso / eachDayIso', () => {
  it('adds days correctly', () => {
    expect(addDaysIso('2026-10-28', 1)).toBe('2026-10-29');
    expect(addDaysIso('2026-10-28', -1)).toBe('2026-10-27');
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('enumerates each day in a range', () => {
    expect(eachDayIso('2026-10-26', '2026-10-28')).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ]);
  });
});
