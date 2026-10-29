import type { JiraClient } from '../clients/jira-client.js';
import type { TempoClient, TempoWorklog } from '../clients/tempo-client.js';
import { DEFAULTS } from '../config/constants.js';
import { minutesToSeconds, secondsToMinutes } from '../utils/duration.js';
import { TtlCache } from '../utils/ttl-cache.js';
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
import type { JiraIssue } from '../clients/jira-client.js';

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
  config: { timezone: string; writeEnabled: boolean; approvalTtlMs: number; tempoAccountId?: string | null };
  logger: Pick<Logger, 'info' | 'warn' | 'error'>;
}

export class WorklogService {
  private readonly tempo: TempoClient | null;
  private readonly jira: JiraClient | null;
  private readonly approvals: ApprovalService;
  private readonly config: { timezone: string; writeEnabled: boolean; approvalTtlMs: number; tempoAccountId?: string | null };
  private readonly logger: Pick<Logger, 'info' | 'warn' | 'error'>;
  #authorAccountId: string | null = null;
  /** Short-lived LRU/TTL cache for Jira issue lookups (id/key -> issue). */
  private readonly issueCache = new TtlCache<string, JiraIssue>({
    ttlMs: DEFAULTS.issueCacheTtlMs,
    maxEntries: DEFAULTS.issueCacheMaxEntries,
  });

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
    // Try Jira first if available
    if (this.jira) {
      try {
        const issue = await this.getIssueCached(this.jira, issueKey);
        const issueId = Number(issue.id);
        if (Number.isInteger(issueId) && issueId > 0) {
          return {
            issueId,
            issueKey: issue.key.toUpperCase(),
            summary: issue.summary,
            status: issue.status,
          };
        }
      } catch (error) {
        // Jira resolution failed - fall through to Tempo numeric ID
        this.logger.warn('Jira resolution failed, falling back to Tempo numeric ID', {
          issueKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Fallback: treat input as Tempo numeric issue ID
    const issueId = Number(issueKey);
    if (!Number.isInteger(issueId) || issueId <= 0) {
      throw new ValidationError(`Issue "${issueKey}" did not resolve to a valid numeric issue id.`);
    }
    return {
      issueId,
      issueKey: `issue-${issueId}`,
      summary: undefined,
      status: undefined,
    };
  }

  /**
   * Resolves Jira keys for display; missing credentials degrade to an empty map.
   *
   * Uses ONE bulk JQL fetch (`id in (...)`) per chunk instead of one getIssue
   * call per issue id (the old N+1 behavior), plus the short-lived issue cache.
   * Behavior is unchanged: ids are deduped and capped at 100, and ids that
   * cannot be resolved are logged and skipped (never fail the tool call).
   */
  async resolveIssueKeys(issueIds: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (!this.jira) return map;
    const ids = [...new Set(issueIds)].slice(0, 100);
    if (ids.length === 0) return map;

    const missing = ids.filter((id) => this.issueCache.get(String(id)) === undefined);
    if (missing.length > 0) {
      await this.bulkFetchIssues(this.jira, missing);
    }

    for (const id of ids) {
      const issue = this.issueCache.get(String(id));
      if (issue?.key) {
        map.set(id, issue.key.toUpperCase());
      } else {
        this.logger.warn('Could not resolve issue key', { issueId: id });
      }
    }
    return map;
  }

  /** Cached single-issue lookup: avoids repeated HTTP calls within the TTL window. */
  private async getIssueCached(jira: JiraClient, keyOrId: string): Promise<JiraIssue> {
    const cached = this.issueCache.get(keyOrId);
    if (cached) return cached;
    const issue = await jira.getIssue(keyOrId);
    this.issueCache.set(keyOrId, issue);
    // Also index by id and key so later lookups by either identifier hit the cache.
    this.issueCache.set(issue.id, issue);
    if (issue.key) this.issueCache.set(issue.key.toUpperCase(), issue);
    return issue;
  }

  /**
   * Fetches a batch of issues with one `id in (...)` JQL search per chunk and
   * primes the cache. Individual failures degrade to a warning, matching the
   * previous per-id error handling.
   */
  private async bulkFetchIssues(jira: JiraClient, ids: number[]): Promise<void> {
    const chunkSize = DEFAULTS.jiraBulkResolveChunkSize;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const jql = `id in (${chunk.map((id) => `"${id}"`).join(', ')})`;
      try {
        const { issues } = await jira.searchIssues({ jql, maxResults: chunk.length });
        for (const issue of issues) {
          this.issueCache.set(issue.id, issue);
          if (issue.key) this.issueCache.set(issue.key.toUpperCase(), issue);
        }
      } catch (error) {
        this.logger.warn('Bulk issue resolution failed for a chunk', {
          chunkSize: chunk.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
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

  /** Lazy-loads and caches the authenticated user's Tempo account ID. */
  private async getAuthorAccountId(): Promise<string> {
    // Use explicitly configured account ID if available
    if (this.config.tempoAccountId) return this.config.tempoAccountId;
    if (this.#authorAccountId !== null) return this.#authorAccountId;
    try {
      const me = await this.tempo!.getMe();
      const accountId = (me as Record<string, unknown>)?.accountId ?? (me as Record<string, unknown>)?.id;
      if (accountId) {
        this.#authorAccountId = String(accountId);
        return this.#authorAccountId;
      }
    } catch (error) {
      this.logger.warn('Could not auto-detect Tempo account ID', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw new ConfigError(
      'TEMPO_ACCOUNT_ID is required for write operations. Set it in your environment (find your accountId from existing worklogs or Tempo Settings → API Integration).',
    );
  }

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

    const authorAccountId = await this.getAuthorAccountId();
    let created: TempoWorklog;
    try {
      created = await tempo.createWorklog(createCreatePayload(resolved, proposal, authorAccountId));
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
      return await this.getIssueCached(this.jira, String(worklog.issue.id));
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
  authorAccountId?: string,
): CreateWorklogPayload {
  const payload: CreateWorklogPayload = {
    issueId: resolved.issueId,
    timeSpentSeconds: minutesToSeconds(proposal.durationMinutes),
    startDate: proposal.date,
    description: proposal.description,
    authorAccountId,
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
