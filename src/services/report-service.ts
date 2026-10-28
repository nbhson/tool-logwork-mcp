import type { TempoWorklog } from '../clients/tempo-client.js';
import { compareIsoDates, eachDayIso } from '../utils/date.js';

/**
 * Timesheet aggregation. Distinguishes strictly between RECORDED data
 * (actual worklogs) and everything else — no invented hours, no assumed work.
 */
export interface IssueBucket {
  issueId: number;
  /** Resolved Jira key when the caller could resolve it; otherwise absent. */
  issueKey?: string;
  totalSeconds: number;
}

export interface DayBucket {
  date: string;
  totalSeconds: number;
  issues: IssueBucket[];
}

export interface TimesheetSummary {
  range: { from: string; to: string };
  totalSeconds: number;
  days: DayBucket[];
  issues: IssueBucket[];
}

export function aggregateWorklogs(
  worklogs: TempoWorklog[],
  opts: { from: string; to: string; issueKeyById?: Map<number, string> },
): TimesheetSummary {
  const from = opts.from;
  const to = opts.to;
  const issueKeyById = opts.issueKeyById;

  const dayBuckets = new Map<string, DayBucket>();
  const issueBuckets = new Map<number, { bucket: IssueBucket; totalSeconds: number }>();

  for (const date of eachDayIso(from, to)) {
    dayBuckets.set(date, { date, totalSeconds: 0, issues: [] });
  }

  let totalSeconds = 0;

  for (const worklog of worklogs) {
    // Keep the aggregation strictly inside the requested window.
    if (compareIsoDates(worklog.startDate, from) < 0) continue;
    if (compareIsoDates(to, worklog.startDate) < 0) continue;

    const day = dayBuckets.get(worklog.startDate);
    if (!day) continue;

    day.totalSeconds += worklog.timeSpentSeconds;
    totalSeconds += worklog.timeSpentSeconds;

    const issueId = worklog.issue.id;
    let dayIssue = day.issues.find((b) => b.issueId === issueId);
    if (!dayIssue) {
      dayIssue = { issueId, totalSeconds: 0 };
      day.issues.push(dayIssue);
    }
    dayIssue.totalSeconds += worklog.timeSpentSeconds;

    const existing = issueBuckets.get(issueId);
    if (existing) {
      existing.totalSeconds += worklog.timeSpentSeconds;
    } else {
      const bucket: IssueBucket = { issueId, totalSeconds: worklog.timeSpentSeconds };
      const resolvedKey = issueKeyById?.get(issueId);
      if (resolvedKey !== undefined) bucket.issueKey = resolvedKey;
      issueBuckets.set(issueId, { bucket, totalSeconds: bucket.totalSeconds });
    }
  }

  const issues = [...issueBuckets.values()].map((entry) => {
    entry.bucket.totalSeconds = entry.totalSeconds;
    return entry.bucket;
  });

  issues.sort((a, b) => b.totalSeconds - a.totalSeconds);
  for (const day of dayBuckets.values()) {
    day.issues.sort((a, b) => b.totalSeconds - a.totalSeconds);
  }

  return {
    range: { from, to },
    totalSeconds,
    days: [...dayBuckets.values()],
    issues,
  };
}
