import type { TempoWorklog } from '../clients/tempo-client.js';

/**
 * Conservative duplicate detection.
 *
 * Heuristics compare available fields (issue, date, duration, description,
 * author). A match is a WARNING with a confidence level and a human-readable
 * reason — never a guarantee of duplication, and never an automatic block.
 *
 * Limitations (documented in docs/security.md):
 * - Only worklogs visible to the API token can be compared.
 * - Same issue + same duration on the same day is NOT treated as a duplicate
 *   by itself; it is a "medium" signal.
 */
export type DuplicateConfidence = 'high' | 'medium' | 'low';

export interface DuplicateMatch {
  tempoWorklogId: number;
  issueId: number;
  startDate: string;
  timeSpentSeconds: number;
  description?: string | null;
  authorAccountId?: string | null;
  confidence: DuplicateConfidence;
  reason: string;
}

export interface DuplicateCheckInput {
  /** Proposal fields. Description optional for the lightweight check tool. */
  issueId: number;
  date: string;
  durationMinutes?: number;
  description?: string;
  authorAccountId?: string;
  /** Worklogs already recorded for the issue/date range. */
  existingWorklogs: TempoWorklog[];
}

export function findDuplicates(input: DuplicateCheckInput): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];

  for (const worklog of input.existingWorklogs) {
    if (worklog.issue.id !== input.issueId) continue;
    if (worklog.startDate !== input.date) continue;

    const sameDuration =
      input.durationMinutes !== undefined &&
      worklog.timeSpentSeconds === input.durationMinutes * 60;
    const sameDescription =
      input.description !== undefined &&
      normalizeText(worklog.description ?? null) === normalizeText(input.description);
    if (sameDuration && sameDescription) {
      matches.push(
        match(worklog, 'high', 'Same issue, date, duration and description already recorded.'),
      );
      continue;
    }
    if (sameDuration) {
      matches.push(match(worklog, 'medium', 'Same issue, date and duration already recorded.'));
      continue;
    }
    matches.push(match(worklog, 'low', 'Another worklog exists for the same issue and date.'));
  }

  return matches;
}

function match(
  worklog: TempoWorklog,
  confidence: DuplicateConfidence,
  reason: string,
): DuplicateMatch {
  return {
    tempoWorklogId: worklog.tempoWorklogId,
    issueId: worklog.issue.id,
    startDate: worklog.startDate,
    timeSpentSeconds: worklog.timeSpentSeconds,
    description: worklog.description ?? null,
    authorAccountId: worklog.author?.accountId ?? null,
    confidence,
    reason,
  };
}

function normalizeText(value: string | null): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
