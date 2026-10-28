import { aggregateWorklogs } from '../../src/services/report-service.js';
import type { TempoWorklog } from '../../src/clients/tempo-client.js';
import { describe, expect, it } from 'vitest';

function w(date: string, issueId: number, seconds: number): TempoWorklog {
  return { tempoWorklogId: 1, issue: { id: issueId }, startDate: date, timeSpentSeconds: seconds };
}

describe('aggregateWorklogs', () => {
  it('groups by day and by issue', () => {
    const worklogs = [
      w('2026-10-26', 100, 3600),
      w('2026-10-26', 200, 1800),
      w('2026-10-27', 100, 7200),
    ];
    const result = aggregateWorklogs(worklogs, { from: '2026-10-26', to: '2026-10-28' });

    expect(result.range.from).toBe('2026-10-26');
    expect(result.range.to).toBe('2026-10-28');
    expect(result.totalSeconds).toBe(12600); // 3600+1800+7200
    expect(result.days).toHaveLength(3);
    expect(result.days[0]?.totalSeconds).toBe(5400);
    expect(result.days[1]?.totalSeconds).toBe(7200);
    expect(result.days[2]?.totalSeconds).toBe(0);
  });

  it('skips worklogs outside the requested range', () => {
    const worklogs = [w('2026-10-25', 100, 3600), w('2026-10-27', 100, 3600)];
    const result = aggregateWorklogs(worklogs, { from: '2026-10-26', to: '2026-10-26' });
    expect(result.totalSeconds).toBe(0);
    expect(result.days[0]?.issues).toHaveLength(0);
  });

  it('returns empty buckets for all days even when no worklogs', () => {
    const result = aggregateWorklogs([], { from: '2026-10-26', to: '2026-10-28' });
    expect(result.days).toHaveLength(3);
    expect(result.totalSeconds).toBe(0);
    expect(result.issues).toHaveLength(0);
  });
});
