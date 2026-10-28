import {
  isIsoDateString,
  isValidCalendarDate,
  weekStartIso,
  weekRangeIso,
  daysBetween,
  eachDayIso,
  addDaysIso,
} from '../../src/utils/date.js';
import { describe, expect, it } from 'vitest';

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
