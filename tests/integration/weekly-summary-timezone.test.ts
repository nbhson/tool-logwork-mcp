import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAllTools } from '../../src/tools/register.js';
import { ApprovalService } from '../../src/services/approval-service.js';
import { WorklogService } from '../../src/services/worklog-service.js';
import { TempoClient } from '../../src/clients/tempo-client.js';
import { JiraClient } from '../../src/clients/jira-client.js';
import { mockFetch } from '../helpers/mock-fetch.js';
import type { ToolContext } from '../../src/tools/context.js';
import type { Logger } from '../../src/utils/logger.js';
import type { McpServer } from '@modelcontextprotocol/server';

const silentLogger: Pick<Logger, 'info' | 'warn' | 'error'> = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

type Handler = (args: unknown) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function captureServer(): { server: McpServer; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

async function call(
  handlers: Map<string, Handler>,
  args: unknown,
): Promise<{ payload: Record<string, unknown>; isError: boolean }> {
  const result = await handlers.get('tempo_get_week_summary')!(args);
  return {
    payload: JSON.parse(result.content[0].text) as Record<string, unknown>,
    isError: result.isError === true,
  };
}

function worklogJson(overrides: Record<string, unknown> = {}) {
  return {
    tempoWorklogId: 7,
    issue: { id: 10001 },
    timeSpentSeconds: 3600,
    startDate: '2026-11-02',
    description: 'Implement feature',
    author: { accountId: 'test-account-id' },
    ...overrides,
  };
}

const jiraSearchRoute = {
  urlIncludes: '/rest/api/3/search/jql',
  respond: () => ({
    status: 200,
    json: { issues: [{ id: '10001', key: 'ABC-1', fields: { summary: 'My issue' } }] },
  }),
};

/**
 * Setup with a configurable timezone so tests can pin how the weekly summary
 * resolves "the current week" from the configured timezone (not the process
 * timezone, not UTC).
 */
function setup(timezone: string) {
  const tempoMock = mockFetch([
    {
      urlIncludes: '/4/worklogs/user/test-account-id',
      respond: () => ({
        status: 200,
        json: { metadata: { count: 1 }, results: [worklogJson()] },
      }),
    },
  ]);
  const approvals = new ApprovalService();
  const worklogService = new WorklogService({
    tempo: new TempoClient({
      baseUrl: 'https://api.tempo.io',
      token: 'tempo-token',
      fetchFn: tempoMock.fetchFn,
      logger: silentLogger,
      sleepFn: async () => undefined,
    }),
    jira: new JiraClient({
      baseUrl: 'https://x.atlassian.net',
      email: 'a@b.c',
      apiToken: 'jira-token',
      fetchFn: mockFetch([jiraSearchRoute]).fetchFn,
      logger: silentLogger,
    }),
    approvals,
    config: {
      timezone,
      writeEnabled: false,
      approvalTtlMs: 60_000,
      tempoAccountId: 'test-account-id',
    },
    logger: silentLogger,
  });
  const ctx: ToolContext = {
    config: {
      tempoApiToken: 'tempo-token',
      tempoAccountId: 'test-account-id',
      tempoBaseUrl: 'https://api.tempo.io',
      jiraBaseUrl: null,
      jiraEmail: null,
      jiraApiToken: null,
      logLevel: 'error' as const,
      timezone,
      writeEnabled: false,
    },
    tempo: worklogService['tempo'],
    jira: worklogService['jira'],
    worklogService,
    approvals,
    logger: silentLogger as Logger,
  };
  const { server, handlers } = captureServer();
  registerAllTools(server, ctx);
  return { handlers, calls: tempoMock.calls };
}

/** Extracts the from/to range Tempo was actually queried with. */
function queriedRange(calls: Array<{ url: string }>): { from: string; to: string } {
  const call = calls.find((c) => c.url.includes('/worklogs/user/'));
  expect(call, 'expected a Tempo worklog query').toBeDefined();
  const url = new URL(call!.url);
  return {
    from: url.searchParams.get('from') ?? '',
    to: url.searchParams.get('to') ?? '',
  };
}

describe('weekly-summary timezone handling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // 2026-11-01 is a SUNDAY. 23:30 UTC on that Sunday lands on Monday
  // 2026-11-02 in UTC+7/+9/+10(+11 DST) zones but is still Sunday in UTC and
  // UTC-10. The two groups must resolve to DIFFERENT current weeks.
  describe('"today" anchor resolves in the configured timezone (mocked clock)', () => {
    const now = '2026-11-01T23:30:00Z';

    it.each([
      // timezone, expected week range
      ['UTC', { from: '2026-10-26', to: '2026-11-01' }],
      ['Pacific/Honolulu', { from: '2026-10-26', to: '2026-11-01' }], // UTC-10: still Sunday
      ['Asia/Ho_Chi_Minh', { from: '2026-11-02', to: '2026-11-08' }], // UTC+7: already Monday
      ['Asia/Tokyo', { from: '2026-11-02', to: '2026-11-08' }], // UTC+9: already Monday
      ['Australia/Sydney', { from: '2026-11-02', to: '2026-11-08' }], // UTC+11 (AEDT): already Monday
    ])('%s queries the week %j', async (timezone, expected) => {
      vi.useFakeTimers({ now: new Date(now) });
      const { handlers, calls } = setup(timezone);
      const { payload, isError } = await call(handlers, {});
      expect(isError).toBe(false);
      expect(payload.range).toEqual(expected);
      expect(queriedRange(calls)).toEqual(expected);
    });
  });

  describe('week boundaries (Monday-anchored weeks, pinned behavior)', () => {
    it('a SUNDAY date closes the previous Monday-started week', async () => {
      const { handlers } = setup('UTC');
      const { payload } = await call(handlers, { date: '2026-11-01' });
      expect(payload.range).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    });

    it('a SATURDAY date belongs to the same week as the following Sunday', async () => {
      const { handlers } = setup('UTC');
      const { payload } = await call(handlers, { date: '2026-10-31' });
      expect(payload.range).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    });

    it('a MONDAY date starts a fresh week', async () => {
      const { handlers } = setup('UTC');
      const { payload } = await call(handlers, { date: '2026-11-02' });
      expect(payload.range).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    });

    it('spans the year boundary correctly (2027-01-01 is a Friday)', async () => {
      const { handlers } = setup('UTC');
      const { payload } = await call(handlers, { date: '2027-01-01' });
      expect(payload.range).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    });

    it('weekStartDate takes precedence over date', async () => {
      const { handlers } = setup('UTC');
      const { payload } = await call(handlers, {
        date: '2026-10-28',
        weekStartDate: '2026-11-02',
      });
      expect(payload.range).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    });

    it('an explicit date is timezone-independent (no "today" resolution)', async () => {
      vi.useFakeTimers({ now: new Date('2026-11-01T23:30:00Z') });
      const { handlers, calls } = setup('Pacific/Honolulu');
      const { payload } = await call(handlers, { date: '2026-10-28' });
      expect(payload.range).toEqual({ from: '2026-10-26', to: '2026-11-01' });
      expect(queriedRange(calls)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    });
  });

  describe('aggregation stays inside the queried window', () => {
    it('worklogs outside the resolved week are excluded from totals and day buckets', async () => {
      const tempoMockRoutes = [
        {
          urlIncludes: '/4/worklogs/user/test-account-id',
          respond: () => ({
            status: 200,
            json: {
              metadata: { count: 2 },
              results: [
                worklogJson({ tempoWorklogId: 1, startDate: '2026-11-02', timeSpentSeconds: 3600 }),
                // The next day after the week ends: must NOT be counted.
                worklogJson({ tempoWorklogId: 2, startDate: '2026-11-09', timeSpentSeconds: 7200 }),
              ],
            },
          }),
        },
      ];
      const approvals = new ApprovalService();
      const worklogService = new WorklogService({
        tempo: new TempoClient({
          baseUrl: 'https://api.tempo.io',
          token: 'tempo-token',
          fetchFn: mockFetch(tempoMockRoutes).fetchFn,
          logger: silentLogger,
          sleepFn: async () => undefined,
        }),
        jira: null,
        approvals,
        config: {
          timezone: 'UTC',
          writeEnabled: false,
          approvalTtlMs: 60_000,
          tempoAccountId: 'test-account-id',
        },
        logger: silentLogger,
      });
      const ctx: ToolContext = {
        config: {
          tempoApiToken: 'tempo-token',
          tempoAccountId: 'test-account-id',
          tempoBaseUrl: 'https://api.tempo.io',
          jiraBaseUrl: null,
          jiraEmail: null,
          jiraApiToken: null,
          logLevel: 'error' as const,
          timezone: 'UTC',
          writeEnabled: false,
        },
        tempo: worklogService['tempo'],
        jira: null,
        worklogService,
        approvals,
        logger: silentLogger as Logger,
      };
      const { server, handlers } = captureServer();
      registerAllTools(server, ctx);

      const { payload, isError } = await call(handlers, { date: '2026-11-02' });
      expect(isError).toBe(false);
      expect(payload.range).toEqual({ from: '2026-11-02', to: '2026-11-08' });
      expect(payload.totalSeconds).toBe(3600); // the 2026-11-09 worklog is excluded
      const days = payload.days as Array<{ date: string; totalSeconds: number }>;
      expect(days.map((d) => d.date)).toEqual([
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
        '2026-11-07',
        '2026-11-08',
      ]);
      expect(payload.daysWithoutRecordedWorklogs).toEqual([
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
        '2026-11-07',
        '2026-11-08',
      ]);
    });
  });
});
