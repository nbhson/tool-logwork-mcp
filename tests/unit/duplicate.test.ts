import { findDuplicates } from '../../src/services/duplicate-service.js';
import type { TempoWorklog } from '../../src/clients/tempo-client.js';
import { describe, expect, it } from 'vitest';

function w(
  id: number,
  issueId: number,
  date: string,
  seconds: number,
  desc?: string,
): TempoWorklog {
  return {
    tempoWorklogId: id,
    issue: { id: issueId },
    startDate: date,
    timeSpentSeconds: seconds,
    description: desc ?? null,
  };
}

describe('findDuplicates', () => {
  it('returns high confidence for exact match', () => {
    const existing = [w(1, 100, '2026-10-28', 3600, 'Implementing feature')];
    const result = findDuplicates({
      issueId: 100,
      date: '2026-10-28',
      durationMinutes: 60,
      description: 'Implementing feature',
      existingWorklogs: existing,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe('high');
  });

  it('returns medium confidence for same issue+date+duration', () => {
    const existing = [w(1, 100, '2026-10-28', 3600, 'Different description')];
    const result = findDuplicates({
      issueId: 100,
      date: '2026-10-28',
      durationMinutes: 60,
      description: 'Something else',
      existingWorklogs: existing,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe('medium');
  });

  it('returns low confidence for same issue+date only', () => {
    const existing = [w(1, 100, '2026-10-28', 3600, 'Original work')];
    const result = findDuplicates({
      issueId: 100,
      date: '2026-10-28',
      durationMinutes: 30,
      description: 'Different task',
      existingWorklogs: existing,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe('low');
  });

  it('returns empty for no match', () => {
    const existing = [w(1, 100, '2026-10-27', 3600, 'Yesterday')];
    const result = findDuplicates({
      issueId: 100,
      date: '2026-10-28',
      durationMinutes: 60,
      existingWorklogs: existing,
    });
    expect(result).toHaveLength(0);
  });

  it('ignores worklogs for different issues', () => {
    const existing = [w(1, 200, '2026-10-28', 3600)];
    const result = findDuplicates({
      issueId: 100,
      date: '2026-10-28',
      durationMinutes: 60,
      existingWorklogs: existing,
    });
    expect(result).toHaveLength(0);
  });

  it('normalises description whitespace', () => {
    const existing = [w(1, 100, '2026-10-28', 3600, '  Implementing  feature  ')];
    const result = findDuplicates({
      issueId: 100,
      date: '2026-10-28',
      durationMinutes: 60,
      description: 'Implementing feature',
      existingWorklogs: existing,
    });
    expect(result[0]?.confidence).toBe('high');
  });
});
