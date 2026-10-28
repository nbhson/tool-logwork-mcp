import type { JiraClient } from '../clients/jira-client.js';
import type { TempoClient, TempoWorklog } from '../clients/tempo-client.js';
import { minutesToSeconds, secondsToMinutes } from '../utils/duration.js';
import {
  ConfigError,
  NetworkError,
  TimeoutError,
  UncertainOutcomeError,
  ValidationError,
} from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { findDuplicates, type DuplicateMatch } from './duplicate-service.js';
import { requireApproval, type ApprovalService } from './approval-service.js';
import { validateWorklogProposal } from './validation-service.js';
import type { WorklogProposal } from '../schemas/worklog.schema.js';
import type { CreateWorklogPayload } from '../clients/tempo-client.js';

/**
 * Orchestrates the worklog lifecycle:
 * resolve issue -> validate -> duplicate check -> preview + approval token ->
 * (on approval) write -> post-write verification.
 *
 * Safety invariants:
 * - A preview NEVER writes.
 * - A successful validation is NOT an approval.
 * - Writes require WORKLOG_WRITE_ENABLED=true AND a valid approval token bound
 *   to the exact payload (any change invalidates the approval).
 * - Uncertain write outcomes (timeout / network error) are reported, never retried.
 */
export interface ResolvedIssue {
  issueId: number;
  issueKey: string;
  summary?: string;
  status?: string;
}

export interface WorklogPreview {
  operation: 'create' | 'update';
  proposal?: {
    issueKey: string;
    issueId: number;
    date: string;
    durationMinutes: number;
    timeSpentSeconds: number;
    description: string;
    startTime?: string;
  };
  worklogId?: number;
  currentWorklog?: TempoWorklog;
  proposedChanges?: Record<string, unknown>;
  issue?: { id: string; key: string; summary?: string; status?: string } | null;
  validation: { errors: string[]; warnings: string[] };
  duplicates: DuplicateMatch[];
  duplicatesError?: string | null;
  duplicatesNote?: string;
  /** Absent when validation produced errors: nothing may be approved. */
  approvalToken?: string;
  expiresInSeconds: number;
}

export interface CreateOutcome {
  worklog: TempoWorklog;
  verification: 'verified' | 'unverified';
  duplicates: DuplicateMatch[];
}

export interface UpdateOutcome {
  worklog: TempoWorklog;
  verification: 'verified' | 'unverified';
  before: TempoWorklog;
}

export type UpdateChanges = {
  description?: string;
  timeSpentSeconds?: number;
  startDate?: string;
  startTime?: string;
};

export interface WorklogServiceDeps {
  tempo: TempoClient | null;
  jira: JiraClient | null;
  approvals: ApprovalService;
  config: { timezone: string; writeEnabled: boolean; approvalTtlMs: number };
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
}

export class WorklogService {
  private readonly tempo: TempoClient | null;
  private readonly jira: JiraClient | null;
  private readonly approvals: ApprovalService;
  private readonly config: { timezone: string; writeEnabled: boolean; approvalTtlMs: number };
  private readonly logger: Pick<Logger, 'info' | 'warn' | 'error'>;

  constructor(deps: WorklogServiceDeps) {
    this.tempo = deps.tempo;
    this.jira = deps.jira;
    this.approvals = deps.approvals;
    this.config = deps.config;
    this.logger = deps.logger;
  }

  // ---------------------------------------------------------------------------
  // Resolution helpers
  // ---------------------------------------------------------------------------

  /** Resolves a Jira issue key (or numeric id) to the Tempo numeric issueId. */
  async resolveIssue(issueKey: string): Promise<ResolvedIssue> {
    const jira = this.requireJira();
    const issue = await jira.getIssue(issueKey);
    const issueId = Number(issue.id);
    if (!Number.isInteger(issueId) || issueId <= 0) {
      throw new ValidationError(`Issue "${issueKey}" did not resolve to a valid numeric issue id.`);
    }
    return {
      issueId,
      issueKey: issue.key.toUpperCase(),
      summary: issue.summary,
      status: issue.status,
    };
  }

  /** Resolves Jira keys for display; missing credentials degrade to an empty map. */
  async resolveIssueKeys(issueIds: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (!this.jira || issueIds.length === 0) return map;
    for (const id of [...new Set(issueIds)].slice(0, 100)) {
      try {
        const issue = await this.jira.getIssue(String(id));
        map.set(id, issue.key.toUpperCase());
      } catch (error) {
        this.logger.warn('Could not resolve issue key', {
          issueId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return map;
  }

  /** Existing worklogs for one issue on one date (used by duplicate detection). */
  async fetchWorklogsForIssueDate(issueId: number, date: string): Promise<TempoWorklog[]> {
    const tempo = this.requireTempo();
    return tempo.getWorklogs({ from: date, to: date, issueIds: [issueId], maxResults: 200 });
  }

  // ---------------------------------------------------------------------------
  // Preview (never writes)
  // ---------------------------------------------------------------------------

  async previewCreate(proposal: WorklogProposal): Promise<WorklogPreview> {
    const resolved = await this.resolveIssue(proposal.issueKey);
    const validation = validateWorklogProposal({
      issueKey: resolved.issueKey,
      date: proposal.date,
      durationMinutes: proposal.durationMinutes,
      description: proposal.description,
      timezone: this.config.timezone,
      issue: { summary: resolved.summary, status: resolved.status },
    });

    let duplicates: DuplicateMatch[] = [];
    let duplicatesError: string | null = null;
    try {
      duplicates = await this.fetchWorklogsForIssueDate(resolved.issueId, proposal.date).then(
        (existing) =>
          findDuplicates({
            issueId: resolved.issueId,
            date: proposal.date,
            durationMinutes: proposal.durationMinutes,
            description: proposal.description,
            existingWorklogs: existing,
          }),
      );
    } catch (error) {
      duplicatesError = error instanceof Error ? error.message : String(error);
    }

    const hasErrors = validation.errors.length > 0;
    const approvalPayload = createApprovalPayload(resolved, proposal);
    const approvalToken =
      hasErrors || this.tempo === null
        ? undefined
        : this.approvals.issueApproval('create', approvalPayload);

    return {
      operation: 'create',
      proposal: {
        issueKey: resolved.issueKey,
        issueId: resolved.issueId,
        date: proposal.date,
        durationMinutes: proposal.durationMinutes,
        timeSpentSeconds: minutesToSeconds(proposal.durationMinutes),
        description: proposal.description,
        startTime: proposal.startTime,
      },
      issue: {
        id: String(resolved.issueId),
        key: resolved.issueKey,
        summary: resolved.summary,
        status: resolved.status,
      },
      validation,
      duplicates,
      duplicatesError,
      approvalToken,
      expiresInSeconds: Math.round(this.config.approvalTtlMs / 1000),
    };
  }

  async previewUpdate(worklogId: number, changes: UpdateChanges): Promise<WorklogPreview> {
    const tempo = this.requireTempo();
    const current = await tempo.getWorklog(worklogId);
    const issue = await this.issueForWorklog(current);

    const targetDate = changes.startDate ?? current.startDate;
    const targetSeconds = changes.timeSpentSeconds ?? current.timeSpentSeconds;
    const targetDescription = changes.description ?? current.description ?? '';

    const validation = validateWorklogProposal({
      issueKey: issue?.key ?? `ISSUE-${current.issue.id}`,
      date: targetDate,
      durationMinutes: secondsToMinutes(targetSeconds),
      description: targetDescription,
      timezone: this.config.timezone,
      issue: issue ? { summary: issue.summary, status: issue.status } : null,
    });

    const hasErrors = validation.errors.length > 0;
    const approvalPayload = { worklogId, changes: normalizedChanges(changes) };
    const approvalToken = hasErrors
      ? undefined
      : this.approvals.issueApproval('update', approvalPayload);

    return {
      operation: 'update',
      worklogId,
      currentWorklog: current,
      proposedChanges: normalizedChanges(changes),
      issue: issue
        ? { id: issue.id, key: issue.key, summary: issue.summary, status: issue.status }
        : null,
      validation,
      duplicates: [],
      duplicatesNote:
        'Duplicate detection for updates compares against the target date; run tempo_check_duplicate for detail.',
      approvalToken,
      expiresInSeconds: Math.round(this.config.approvalTtlMs / 1000),
    };
  }

  // ---------------------------------------------------------------------------
  // Write (requires WORKLOG_WRITE_ENABLED=true + valid approval token)
  // ---------------------------------------------------------------------------

  async createWorklog(input: {
    issueKey: string;
    date: string;
    durationMinutes: number;
    description: string;
    startTime?: string;
    approvalToken: string;
  }): Promise<CreateOutcome> {
    this.assertWriteEnabled();
    const tempo = this.requireTempo();
    const resolved = await this.resolveIssue(input.issueKey);
    const proposal: WorklogProposal = {
      issueKey: input.issueKey,
      date: input.date,
      durationMinutes: input.durationMinutes,
      description: input.description,
      startTime: input.startTime,
    };
    requireApproval(
      this.approvals.validateApproval(
        input.approvalToken,
        'create',
        createApprovalPayload(resolved, proposal),
      ),
    );

    const duplicates = await this.duplicatesForDate(
      resolved.issueId,
      input.date,
      input.durationMinutes,
      input.description,
    );

    let created: TempoWorklog;
    try {
      created = await tempo.createWorklog(createCreatePayload(resolved, proposal));
    } catch (error) {
      throw uncertainIfTransient(error, 'create');
    }
    this.logger.info('Worklog created', { tempoWorklogId: created.tempoWorklogId });
    const verification = await this.verify(created.tempoWorklogId);
    return { worklog: created, verification, duplicates };
  }

  async updateWorklog(input: {
    worklogId: number;
    changes: UpdateChanges;
    approvalToken: string;
  }): Promise<UpdateOutcome> {
    this.assertWriteEnabled();
    const tempo = this.requireTempo();
    const before = await tempo.getWorklog(input.worklogId);
    requireApproval(
      this.approvals.validateApproval(input.approvalToken, 'update', {
        worklogId: input.worklogId,
        changes: normalizedChanges(input.changes),
      }),
    );

    let updated: TempoWorklog;
    try {
      updated = await tempo.updateWorklog(input.worklogId, updatePayloadFor(before, input.changes));
    } catch (error) {
      throw uncertainIfTransient(error, 'update');
    }
    this.logger.info('Worklog updated', { tempoWorklogId: input.worklogId });
    const verification = await this.verify(input.worklogId);
    return { worklog: updated, verification, before };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private requireTempo(): TempoClient {
    if (!this.tempo) {
      throw new ConfigError('TEMPO_API_TOKEN is not configured; Tempo operations are unavailable.');
    }
    return this.tempo;
  }

  private assertWriteEnabled(): void {
    if (!this.config.writeEnabled) {
      throw new ConfigError(
        'Write operations are disabled. Set WORKLOG_WRITE_ENABLED=true to allow writing worklogs.',
      );
    }
  }

  private requireJira(): JiraClient {
    if (!this.jira) {
      throw new ConfigError(
        'Jira is not configured (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN). Issue resolution and search require Jira access.',
      );
    }
    return this.jira;
  }

  private async duplicatesForDate(
    issueId: number,
    date: string,
    durationMinutes?: number,
    description?: string,
  ): Promise<DuplicateMatch[]> {
    const existing = await this.fetchWorklogsForIssueDate(issueId, date);
    return findDuplicates({
      issueId,
      date,
      durationMinutes,
      description,
      existingWorklogs: existing,
    });
  }

  private async issueForWorklog(worklog: TempoWorklog) {
    if (!this.jira) return null;
    try {
      return await this.jira.getIssue(String(worklog.issue.id));
    } catch {
      return null;
    }
  }

  private async verify(worklogId: number): Promise<'verified' | 'unverified'> {
    try {
      await this.requireTempo().getWorklog(worklogId);
      return 'verified';
    } catch (error) {
      this.logger.warn('Post-write verification failed', {
        worklogId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'unverified';
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function createApprovalPayload(
  resolved: ResolvedIssue,
  proposal: WorklogProposal,
): Record<string, unknown> {
  return {
    kind: 'create',
    issueKey: resolved.issueKey,
    issueId: resolved.issueId,
    date: proposal.date,
    durationMinutes: proposal.durationMinutes,
    description: proposal.description,
    startTime: proposal.startTime,
  };
}

function createCreatePayload(
  resolved: ResolvedIssue,
  proposal: WorklogProposal,
): CreateWorklogPayload {
  const payload: CreateWorklogPayload = {
    issueId: resolved.issueId,
    timeSpentSeconds: minutesToSeconds(proposal.durationMinutes),
    startDate: proposal.date,
    description: proposal.description,
  };
  if (proposal.startTime !== undefined) payload.startTime = proposal.startTime;
  return payload;
}

function updatePayloadFor(current: TempoWorklog, changes: UpdateChanges): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    // v4 PUT identifies the issue by issueId (see docs/api-contract.md for the issueKey/issueId discrepancy).
    issueId: current.issue.id,
  };
  if (changes.description !== undefined) payload.description = changes.description;
  if (changes.timeSpentSeconds !== undefined) payload.timeSpentSeconds = changes.timeSpentSeconds;
  if (changes.startDate !== undefined) payload.startDate = changes.startDate;
  if (changes.startTime !== undefined) payload.startTime = changes.startTime;
  return payload;
}

function uncertainIfTransient(error: unknown, operation: 'create' | 'update'): Error {
  if (error instanceof TimeoutError || error instanceof NetworkError) {
    return new UncertainOutcomeError(
      `The ${operation} request did not complete reliably (${error.message}). ` +
        'The result is UNKNOWN: call tempo_get_worklogs for the affected date to check whether the worklog exists. ' +
        'Do NOT retry the write until the current state has been verified.',
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function normalizedChanges(changes: UpdateChanges): UpdateChanges {
  const normalized: UpdateChanges = {};
  if (changes.description !== undefined) normalized.description = changes.description;
  if (changes.timeSpentSeconds !== undefined)
    normalized.timeSpentSeconds = changes.timeSpentSeconds;
  if (changes.startDate !== undefined) normalized.startDate = changes.startDate;
  if (changes.startTime !== undefined) normalized.startTime = changes.startTime;
  return normalized;
}
