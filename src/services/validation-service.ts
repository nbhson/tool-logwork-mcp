import { isoDateSchema } from '../schemas/worklog.schema.js';
import { todayInTz, compareIsoDates } from '../utils/date.js';

/**
 * Business validation for worklog proposals.
 *
 * Principle: only hard, universal constraints produce errors. Company-specific
 * rules (e.g. "max 8h/day") are NOT invented here; soft signals are reported
 * as warnings and left for the user to judge.
 */
export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export interface ValidationInput {
  /** Already-resolved issue key (uppercase) — existence is checked by the caller. */
  issueKey: string;
  date: string;
  durationMinutes: number;
  description: string;
  timezone: string;
  /** Resolved Jira issue, when available. */
  issue?: { summary?: string; status?: string } | null;
  /** Injectable "now" for tests. */
  nowIsoDate?: string;
}

export function validateWorklogProposal(input: ValidationInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Date: schema already validated format; here we check semantic sanity.
  const date = isoDateSchema.safeParse(input.date);
  if (!date.success) {
    errors.push('Date must be a valid ISO calendar date (YYYY-MM-DD).');
    return { errors, warnings };
  }

  const today = input.nowIsoDate ?? todayInTz(input.timezone);
  const comparison = compareIsoDates(input.date, today);

  if (comparison > 0) {
    warnings.push(
      `The worklog date ${input.date} is in the future (today is ${today} in ${input.timezone}). Tempo allows future entries but this is usually unintended.`,
    );
  }

  // Duration: schema enforces integer 1..1440; no company rule invented.
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1) {
    errors.push('durationMinutes must be a positive integer.');
  }

  // Description.
  if (input.description.trim().length === 0) {
    errors.push('Description must not be empty.');
  }

  // Issue context (advisory only — existence/access is enforced by the API).
  if (input.issue) {
    if (input.issue.status && /done|closed|resolved/i.test(input.issue.status)) {
      warnings.push(
        `Issue ${input.issueKey} has status "${input.issue.status}". Logging work against a resolved issue may be unintended.`,
      );
    }
  }

  return { errors, warnings };
}
