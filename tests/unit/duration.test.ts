import {
  parseDurationMinutes,
  formatDuration,
  minutesToSeconds,
  secondsToMinutes,
} from '../../src/utils/duration.js';
import { ValidationError } from '../../src/utils/errors.js';
import { describe, expect, it } from 'vitest';

describe('parseDurationMinutes', () => {
  it('parses hours and minutes', () => {
    expect(parseDurationMinutes('1h30m')).toBe(90);
    expect(parseDurationMinutes('1h 30m')).toBe(90);
    expect(parseDurationMinutes('2h')).toBe(120);
  });

  it('parses minutes only', () => {
    expect(parseDurationMinutes('90m')).toBe(90);
    expect(parseDurationMinutes('90 min')).toBe(90);
    expect(parseDurationMinutes('90')).toBe(90);
    expect(parseDurationMinutes('45')).toBe(45);
  });

  it('parses decimal hours', () => {
    expect(parseDurationMinutes('1.5h')).toBe(90);
    expect(parseDurationMinutes('1h')).toBe(60);
  });

  it('throws for invalid input', () => {
    expect(() => parseDurationMinutes('')).toThrow(ValidationError);
    expect(() => parseDurationMinutes('abc')).toThrow(ValidationError);
    expect(() => parseDurationMinutes('0')).toThrow(ValidationError);
    expect(() => parseDurationMinutes('1441m')).toThrow(ValidationError);
  });
});

describe('formatDuration', () => {
  it('formats correctly', () => {
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(30)).toBe('30m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(75)).toBe('1h 15m');
  });
});

describe('minutesToSeconds / secondsToMinutes', () => {
  it('converts correctly', () => {
    expect(minutesToSeconds(90)).toBe(5400);
    expect(secondsToMinutes(5400)).toBe(90);
  });

  it('throws for non-round seconds', () => {
    expect(() => secondsToMinutes(90)).toThrow(ValidationError);
    expect(() => secondsToMinutes(5401)).toThrow(ValidationError);
  });
});
