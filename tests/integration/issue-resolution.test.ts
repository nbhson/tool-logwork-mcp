import { describe, expect, it } from 'vitest';
import { WorklogService } from '../../src/services/worklog-service.js';
import { ApprovalService } from '../../src/services/approval-service.js';
import { TempoClient } from '../../src/clients/tempo-client.js';
import { JiraClient } from '../../src/clients/jira-client.js';
import { mockFetch } from '../helpers/mock-fetch.js';
import type { Logger } from '../../src/utils/logger.js';

const silentLogger: Pick<Logger, 'info' | 'warn' | 'error'> = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function makeService(opts?: { jiraRoutes?: Parameters<typeof mockFetch>[0] }) {
  const jiraMock = mockFetch(opts?.jiraRoutes ?? []);
  const tempoMock = mockFetch([]);
  const service = new WorklogService({
    tempo: new TempoClient({
      baseUrl: 'https://api.tempo.io',
      token: 't',
      fetchFn: tempoMock.fetchFn,
      logger: silentLogger,
    }),
    jira: new JiraClient({
      baseUrl: 'https://x.atlassian.net',
      email: 'a@b.c',
      apiToken: 't',
      fetchFn: jiraMock.fetchFn,
      logger: silentLogger,
    }),
    approvals: new ApprovalService(),
    config: {
      timezone: 'UTC',
      writeEnabled: false,
      approvalTtlMs: 60_000,
      tempoAccountId: 'test-account-id',
    },
    logger: silentLogger,
  });
  return { service, jiraCalls: jiraMock.calls, tempoCalls: tempoMock.calls };
}

/** Responds to the bulk `id in (...)` search with one issue per requested id. */
function bulkSearchRoute(): Parameters<typeof mockFetch>[0][number] {
  return {
    urlIncludes: '/rest/api/3/search/jql',
    method: 'POST',
    respond: ({ body }) => {
      const parsed = JSON.parse(body ?? '{}') as { jql: string };
      const ids = [...parsed.jql.matchAll(/"(\d+)"/g)].map((m) => m[1] as string);
      return {
        status: 200,
        json: {
          issues: ids.map((id) => ({
            id,
            key: `KEY-${id}`,
            fields: { summary: `Issue ${id}` },
          })),
          isLast: true,
        },
      };
    },
  };
}

describe('WorklogService issue resolution (batch + cache)', () => {
  it('resolves many issue keys with a single bulk JQL request instead of N calls', async () => {
    const { service, jiraCalls } = makeService({ jiraRoutes: [bulkSearchRoute()] });

    const map = await service.resolveIssueKeys([101, 102, 103, 101]); // 101 duplicated on purpose

    expect(map.size).toBe(3);
    expect(map.get(101)).toBe('KEY-101');
    expect(map.get(102)).toBe('KEY-102');
    expect(map.get(103)).toBe('KEY-103');

    // Exactly ONE HTTP call for 4 (3 unique) issues.
    expect(jiraCalls).toHaveLength(1);
    const body = JSON.parse(jiraCalls[0]?.body ?? '{}') as { jql: string };
    expect(body.jql).toContain('id in (');
    expect(body.jql).toContain('"101"');
  });

  it('caches issue lookups: a repeated resolveIssue does not hit HTTP again', async () => {
    const { service, jiraCalls } = makeService({ jiraRoutes: [bulkSearchRoute()] });

    await service.resolveIssueKeys([201, 202]);
    expect(jiraCalls).toHaveLength(1);

    // Second call is served from the TTL cache -> still one HTTP request.
    const map = await service.resolveIssueKeys([201, 202]);
    expect(jiraCalls).toHaveLength(1);
    expect(map.get(201)).toBe('KEY-201');

    // Single resolveIssue for a cached id is also cache-backed.
    const resolved = await service.resolveIssue('202');
    expect(resolved.issueId).toBe(202);
    expect(resolved.issueKey).toBe('KEY-202');
    expect(jiraCalls).toHaveLength(1);
  });

  it('chunks bulk resolution when there are many ids', async () => {
    const ids = Array.from({ length: 75 }, (_, i) => 300 + i);
    const { service, jiraCalls } = makeService({ jiraRoutes: [bulkSearchRoute()] });

    const map = await service.resolveIssueKeys(ids);

    expect(map.size).toBe(75);
    // 75 ids / chunk size 50 -> 2 bulk requests.
    expect(jiraCalls).toHaveLength(2);
  });

  it('degrades gracefully when the bulk search fails (warn, empty map)', async () => {
    const { service, jiraCalls } = makeService({
      jiraRoutes: [
        {
          urlIncludes: '/rest/api/3/search/jql',
          method: 'POST',
          respond: () => ({ status: 500, json: {} }),
        },
      ],
    });

    const map = await service.resolveIssueKeys([401, 402]);
    expect(map.size).toBe(0);
    // Retried per chunk only; non-retryable 500 on POST -> no retry storm.
    expect(jiraCalls).toHaveLength(1);
  });

  it('returns an empty map when Jira is not configured', async () => {
    const tempoMock = mockFetch([]);
    const service = new WorklogService({
      tempo: new TempoClient({
        baseUrl: 'https://api.tempo.io',
        token: 't',
        fetchFn: tempoMock.fetchFn,
        logger: silentLogger,
      }),
      jira: null,
      approvals: new ApprovalService(),
      config: {
        timezone: 'UTC',
        writeEnabled: false,
        approvalTtlMs: 60_000,
        tempoAccountId: 'test-account-id',
      },
      logger: silentLogger,
    });
    const map = await service.resolveIssueKeys([1, 2, 3]);
    expect(map.size).toBe(0);
  });
});
