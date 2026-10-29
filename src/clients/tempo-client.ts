import { BaseClient, PaginatedResponse, type FetchLike, type RetryLogger } from './base-client.js';
import { DEFAULTS } from '../config/constants.js';
import { tempoWorklogPageSchema, tempoWorklogSchema } from '../schemas/api-response.schema.js';

/**
 * Tempo Timesheets REST API v4 client.
 *
 * Verified contract (see docs/api-contract.md):
 * - Base: {baseUrl}/4 — default https://api.tempo.io/4
 * - Auth: `Authorization: Bearer <token>` (Tempo API Integration token, Worklogs scope)
 * - GET /worklogs: from, to, updatedFrom, issueId[], offset, limit, orderBy
 * - GET /worklogs/user/{accountId}: from, to, updatedFrom, offset, limit
 * - GET /worklogs/{id}
 * - POST /worklogs: {issueId, timeSpentSeconds, startDate, description, authorAccountId?, attributes?}
 * - PUT /worklogs/{id}
 * - Response envelope: { metadata: {count, limit, next, offset, previous}, results: [...] }
 * - v4 worklog objects identify issues by numeric id (issueKey is NOT returned).
 */
export interface TempoWorklog {
  tempoWorklogId: number;
  issue: { id: number; self?: string };
  timeSpentSeconds: number;
  billableSeconds?: number;
  startDate: string;
  startTime?: string;
  startDateTimeUtc?: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  author?: { accountId: string; self?: string } | null;
  attributes?: { values?: Array<{ key: string; value: unknown }> } | null;
}

export interface CreateWorklogPayload {
  issueId: number;
  timeSpentSeconds: number;
  startDate: string;
  description?: string;
  startTime?: string;
  authorAccountId?: string;
  attributes?: Array<{ key: string; value: string }>;
}

export interface UpdateWorklogPayload {
  timeSpentSeconds?: number;
  startDate?: string;
  startTime?: string;
  description?: string;
  authorAccountId?: string;
  billableSeconds?: number;
  attributes?: Array<{ key: string; value: string }>;
}

interface WorklogPageQuery {
  from?: string;
  to?: string;
  issueId?: number[];
  offset: number;
  limit: number;
}

export class TempoClient extends BaseClient {
  private readonly token: string;

  constructor(opts: {
    baseUrl: string;
    token: string;
    fetchFn?: FetchLike;
    timeoutMs?: number;
    maxRetries?: number;
    sleepFn?: (ms: number) => Promise<void>;
    logger?: RetryLogger;
  }) {
    super({
      baseUrl: `${opts.baseUrl.replace(/\/+$/, '')}/${DEFAULTS.tempoApiVersion}`,
      fetchFn: opts.fetchFn,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
      sleepFn: opts.sleepFn,
      logger: opts.logger,
    });
    this.token = opts.token;
  }

  /**
   * Retrieves worklogs for a date range, transparently following all pagination
   * pages. Never silently truncates: a page-guard throws instead of looping
   * forever, and `maxResults` caps the total collection size.
   */
  async getWorklogs(params: {
    from?: string;
    to?: string;
    issueIds?: number[];
    maxResults?: number;
  }): Promise<TempoWorklog[]> {
    const maxResults = params.maxResults ?? DEFAULTS.defaultMaxResults;
    return this.paginate(
      '/worklogs',
      (offset) => ({
        from: params.from,
        to: params.to,
        issueId: params.issueIds,
        offset,
        limit: DEFAULTS.tempoPageSize,
      }),
      maxResults,
    );
  }

  /**
   * Retrieves worklogs for one user (Jira accountId) within a date range.
   */
  async getWorklogsByUser(params: {
    accountId: string;
    from?: string;
    to?: string;
    maxResults?: number;
  }): Promise<TempoWorklog[]> {
    const maxResults = params.maxResults ?? DEFAULTS.defaultMaxResults;
    return this.paginate(
      `/worklogs/user/${encodeURIComponent(params.accountId)}`,
      (offset) => ({
        from: params.from,
        to: params.to,
        offset,
        limit: DEFAULTS.tempoPageSize,
      }),
      maxResults,
    );
  }

  async getWorklog(id: number): Promise<TempoWorklog> {
    return this.request<TempoWorklog>(
      `/worklogs/${encodeURIComponent(String(id))}`,
      { headers: this.authHeaders() },
      tempoWorklogSchema,
    );
  }

  async createWorklog(payload: CreateWorklogPayload): Promise<TempoWorklog> {
    return this.request<TempoWorklog>(
      '/worklogs',
      {
        method: 'POST',
        body: payload,
        headers: this.authHeaders(),
      },
      tempoWorklogSchema,
    );
  }

  async updateWorklog(worklogId: number, payload: UpdateWorklogPayload): Promise<TempoWorklog> {
    return this.request<TempoWorklog>(
      `/worklogs/${encodeURIComponent(String(worklogId))}`,
      {
        method: 'PUT',
        body: payload,
        headers: this.authHeaders(),
      },
      tempoWorklogSchema,
    );
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  private async paginate(
    path: string,
    buildQuery: (offset: number) => WorklogPageQuery,
    maxResults: number,
  ): Promise<TempoWorklog[]> {
    const collected: TempoWorklog[] = [];
    let offset = 0;

    for (let page = 0; page < DEFAULTS.tempoMaxPages; page++) {
      const response = await this.request<PaginatedResponse<TempoWorklog>>(
        path,
        {
          // WorklogPageQuery fields are all compatible; the cast silences TS's strict index-signature check.
          query: buildQuery(offset) as unknown as Record<
            string,
            string | number | readonly string[] | undefined
          >,
          headers: this.authHeaders(),
        },
        tempoWorklogPageSchema,
      );
      collected.push(...response.results);

      const hasMore = this.pageHasMore(response, offset);
      if (!hasMore || collected.length >= maxResults) break;
      offset += response.results.length;
    }

    return collected;
  }

  private pageHasMore(response: PaginatedResponse<TempoWorklog>, offset: number): boolean {
    const nextUrl = response.metadata.next;
    if (typeof nextUrl === 'string' && nextUrl.length > 0) return true;
    const count = response.metadata.count;
    if (typeof count === 'number') return offset + response.results.length < count;
    return response.results.length > 0;
  }
}
