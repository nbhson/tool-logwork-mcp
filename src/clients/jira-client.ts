import { BaseClient, type FetchLike, type RetryLogger } from './base-client.js';
import { DEFAULTS } from '../config/constants.js';
import {
  jiraEnhancedSearchResponseSchema,
  jiraIssueRawSchema,
} from '../schemas/api-response.schema.js';

/**
 * Jira Cloud REST API v3 client (read-only usage in this MVP).
 *
 * Verified contract (see docs/api-contract.md):
 * - Auth: HTTP Basic with `email:api_token` (Atlassian API token)
 * - POST /rest/api/3/search/jql — enhanced search (legacy /search is being
 *   removed by Atlassian) with pagination via `nextPageToken`
 * - GET /rest/api/3/issue/{issueIdOrKey}
 */
export interface JiraIssue {
  id: string;
  key: string;
  summary?: string;
  status?: string;
  issueType?: string;
  projectKey?: string;
}

interface JiraIssueRaw {
  id: string;
  key: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    issuetype?: { name?: string };
    project?: { key?: string };
  };
}

interface EnhancedSearchResponse {
  issues?: JiraIssueRaw[];
  nextPageToken?: string;
  isLast?: boolean;
}

export interface IssueSearchResult {
  issues: JiraIssue[];
  /** True when more pages existed but the collected limit was reached. */
  truncated: boolean;
}

const SEARCH_FIELDS = ['summary', 'status', 'issuetype', 'project'];

export class JiraClient extends BaseClient {
  private readonly authHeaderValue: string;

  constructor(opts: {
    baseUrl: string;
    email: string;
    apiToken: string;
    fetchFn?: FetchLike;
    timeoutMs?: number;
    maxRetries?: number;
    sleepFn?: (ms: number) => Promise<void>;
    logger?: RetryLogger;
  }) {
    super({
      baseUrl: opts.baseUrl.replace(/\/+$/, ''),
      fetchFn: opts.fetchFn,
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries,
      sleepFn: opts.sleepFn,
      logger: opts.logger,
    });
    this.authHeaderValue = Buffer.from(`${opts.email}:${opts.apiToken}`).toString('base64');
  }

  /** Resolves a single issue by key or numeric id. */
  async getIssue(keyOrId: string): Promise<JiraIssue> {
    const raw = await this.request<JiraIssueRaw>(
      `/rest/api/${DEFAULTS.jiraApiVersion}/issue/${encodeURIComponent(keyOrId)}`,
      {
        query: { fields: SEARCH_FIELDS.join(',') },
        headers: this.authHeaders(),
      },
      jiraIssueRawSchema,
    );
    return normalizeIssue(raw);
  }

  /**
   * Searches issues via POST /rest/api/3/search/jql (the enhanced search endpoint;
   * legacy /rest/api/3/search is being removed by Atlassian).
   * Follows `nextPageToken` pagination up to maxResults; reports truncation honestly.
   */
  async searchIssues(params: { jql: string; maxResults?: number }): Promise<IssueSearchResult> {
    const maxResults = params.maxResults ?? DEFAULTS.jiraPageSize;
    let nextPageToken: string | undefined;
    const issues: JiraIssue[] = [];

    for (let page = 0; page < DEFAULTS.jiraMaxPages; page++) {
      const body: Record<string, unknown> = {
        jql: params.jql,
        maxResults: Math.max(1, Math.min(maxResults - issues.length, 100)),
        fields: [...SEARCH_FIELDS],
      };
      if (nextPageToken !== undefined) body.nextPageToken = nextPageToken;

      const response = await this.request<EnhancedSearchResponse>(
        '/rest/api/3/search/jql',
        {
          method: 'POST',
          body,
          headers: this.authHeaders(),
        },
        jiraEnhancedSearchResponseSchema,
      );

      for (const raw of response.issues ?? []) {
        issues.push(normalizeIssue(raw));
      }

      const token = response.nextPageToken;
      if (token === undefined) return { issues, truncated: false };
      if (issues.length >= maxResults) return { issues, truncated: true };
      nextPageToken = token;
    }

    return { issues, truncated: true };
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Basic ${this.authHeaderValue}` };
  }
}

function normalizeIssue(raw: JiraIssueRaw): JiraIssue {
  const fields = raw.fields ?? {};
  return {
    id: raw.id,
    key: raw.key,
    summary: fields?.summary,
    status: fields?.status?.name,
    issueType: fields?.issuetype?.name,
    projectKey: fields?.project?.key,
  };
}
