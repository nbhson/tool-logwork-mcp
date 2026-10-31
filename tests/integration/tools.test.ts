import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerAllTools } from '../../src/tools/register.js';
import { ApprovalService } from '../../src/services/approval-service.js';
import { WorklogService } from '../../src/services/worklog-service.js';
import { TempoClient } from '../../src/clients/tempo-client.js';
import { JiraClient } from '../../src/clients/jira-client.js';
import { mockFetch } from '../helpers/mock-fetch.js';
import { loadConfig } from '../../src/config/env.js';
import type { ToolContext } from '../../src/tools/context.js';
import type { Logger } from '../../src/utils/logger.js';

const silentLogger: Pick<Logger, 'info' | 'warn' | 'error'> = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

type Handler = (args: unknown) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

/** Captures tool registrations without the real MCP transport. */
function captureServer(): { server: McpServer; handlers: Map<string, Handler>; names: string[] } {
  const handlers = new Map<string, Handler>();
  const names: string[] = [];
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      handlers.set(name, handler);
      names.push(name);
    },
  } as unknown as McpServer;
  return { server, handlers, names };
}

/** Calls a captured handler and returns the parsed JSON payload plus isError. */
async function call(
  handlers: Map<string, Handler>,
  name: string,
  args: unknown,
): Promise<{ payload: Record<string, unknown>; isError: boolean }> {
  const result = await handlers.get(name)!(args);
  return {
    payload: JSON.parse(result.content[0].text) as Record<string, unknown>,
    isError: result.isError === true,
  };
}

const jiraIssueRoutes = [
  {
    urlIncludes: '/rest/api/3/issue/ABC-1',
    respond: () => ({
      status: 200,
      json: {
        id: '10001',
        key: 'ABC-1',
        fields: { summary: 'My issue', status: { name: 'In Progress' } },
      },
    }),
  },
  {
    urlIncludes: '/rest/api/3/search/jql',
    method: 'POST',
    respond: () => ({
      status: 200,
      json: {
        issues: [
          {
            id: '10001',
            key: 'ABC-1',
            fields: { summary: 'My issue', status: { name: 'In Progress' } },
          },
        ],
      },
    }),
  },
];

const emptyWorklogsRoute = {
  urlIncludes: '/4/worklogs',
  method: 'GET',
  respond: () => ({ status: 200, json: { metadata: { count: 0 }, results: [] } }),
};function worklogJson(overrides: Record<string, unknown> = {}) {
  return {
    tempoWorklogId: 7,
    issue: { id: 10001 },
    timeSpentSeconds: 5400,
    startDate: '2026-10-28',
    description: 'Implement feature',
    author: { accountId: 'test-account-id' },
    ...overrides,
  };
}

interface SetupOptions {
  writeEnabled?: boolean;
  tempoRoutes?: Array<{ urlIncludes: string; method?: string; respond: () => unknown }>;
  jiraRoutes?: Array<{ urlIncludes: string; respond: () => unknown }>;
  env?: Record<string, string>;
}

function setup(opts: SetupOptions = {}) {
  const tempoMock = mockFetch(opts.tempoRoutes ?? []);
  const jiraMock = mockFetch(opts.jiraRoutes ?? opts.tempoRoutes ?? []);
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
      fetchFn: jiraMock.fetchFn,
      logger: silentLogger,
    }),
    approvals,
    config: {
      timezone: 'UTC',
      writeEnabled: opts.writeEnabled ?? false,
      approvalTtlMs: 60_000,
      tempoAccountId: 'test-account-id',
    },
    logger: silentLogger,
  });
  const config = loadConfig({
    env: {
      TEMPO_API_TOKEN: 'tempo-token',
      WORKLOG_WRITE_ENABLED: opts.writeEnabled ? 'true' : undefined,
      ...opts.env,
    } as NodeJS.ProcessEnv,
  });
  const ctx: ToolContext = {
    config,
    tempo: worklogService['tempo'],
    jira: worklogService['jira'],
    worklogService,
    approvals,
    logger: silentLogger as Logger,
  };
  const { server, handlers, names } = captureServer();
  registerAllTools(server, ctx);
  return { handlers, names, allCalls: () => [...tempoMock.calls, ...jiraMock.calls] };
}

describe('MCP tool handlers', () => {
  it('registers all 9 tools with stable names', () => {
    const { names } = setup();
    expect(names).toHaveLength(9);
    expect(names).toContain('tempo_get_worklogs');
    expect(names).toContain('tempo_get_worklog');
    expect(names).toContain('jira_search_issues');
    expect(names).toContain('tempo_get_week_summary');
    expect(names).toContain('tempo_preview_worklog');
    expect(names).toContain('tempo_validate_worklog');
    expect(names).toContain('tempo_check_duplicate');
    expect(names).toContain('tempo_create_worklog');
    expect(names).toContain('tempo_update_worklog');
  });

  it('tempo_get_worklogs rejects an inverted date range as a structured error', async () => {
    const { handlers } = setup();
    const { payload, isError } = await call(handlers, 'tempo_get_worklogs', {
      startDate: '2026-10-28',
      endDate: '2026-10-01',
    });
    expect(isError).toBe(true);
    expect(payload).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('tempo_get_worklogs scopes to the caller account and maps issue keys', async () => {
    const { handlers, allCalls } = setup({
      tempoRoutes: [
        {
          urlIncludes: '/4/worklogs/user/test-account-id',
          respond: () => ({
            status: 200,
            json: { metadata: { count: 1 }, results: [worklogJson()] },
          }),
        },
      ],
      jiraRoutes: jiraIssueRoutes,
    });
    const { payload, isError } = await call(handlers, 'tempo_get_worklogs', {
      startDate: '2026-10-28',
      endDate: '2026-10-28',
    });
    expect(isError).toBe(false);
    expect(payload.authorScope).toBe('test-account-id');
    expect(payload.count).toBe(1);
    const worklogs = payload.worklogs as Array<Record<string, unknown>>;
    expect(worklogs[0].issueKey).toBe('ABC-1');
    expect(worklogs[0].timeSpentMinutes).toBe(90);
    expect(allCalls().some((c) => c.url.includes('/worklogs/user/'))).toBe(true);
  });

  it('tempo_get_worklog returns one mapped worklog', async () => {
    const { handlers } = setup({
      tempoRoutes: [
        { urlIncludes: '/4/worklogs/7', respond: () => ({ status: 200, json: worklogJson() }) },
      ],
      jiraRoutes: jiraIssueRoutes,
    });
    const { payload, isError } = await call(handlers, 'tempo_get_worklog', { worklogId: 7 });
    expect(isError).toBe(false);
    expect(payload).toMatchObject({ tempoWorklogId: 7, issueKey: 'ABC-1' });
  });

  it('jira_search_issues requires at least one criterion', async () => {
    const { handlers } = setup();
    const { payload, isError } = await call(handlers, 'jira_search_issues', {});
    expect(isError).toBe(true);
    expect(payload).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('jira_search_issues passes caller JQL through to the enhanced search endpoint', async () => {
    const { handlers, allCalls } = setup({
      tempoRoutes: [],
      jiraRoutes: [
        {
          urlIncludes: '/rest/api/3/search/jql',
          method: 'POST',
          respond: () => ({
            status: 200,
            json: { issues: [{ id: '10001', key: 'ABC-1', fields: { summary: 'My issue' } }] },
          }),
        },
      ],
    });
    const { payload, isError } = await call(handlers, 'jira_search_issues', {
      jql: 'project = ABC',
    });
    expect(isError).toBe(false);
    expect(payload).toMatchObject({ jql: 'project = ABC', count: 1 });
    const searchCall = allCalls().find((c) => c.url.includes('/rest/api/3/search/jql'));
    expect(searchCall?.method).toBe('POST');
    expect(JSON.parse(searchCall?.body ?? '{}')).toMatchObject({ jql: 'project = ABC' });
  });

  it('tempo_preview_worklog accepts the flattened (OpenCode-compat) create input and issues a token', async () => {
    const { handlers } = setup({
      tempoRoutes: [emptyWorklogsRoute],
      jiraRoutes: jiraIssueRoutes,
    });
    const { payload, isError } = await call(handlers, 'tempo_preview_worklog', {
      operation: 'create',
      issueKey: 'ABC-1',
      date: '2026-10-28',
      durationMinutes: 90,
      description: 'Implement feature',
    });
    expect(isError).toBe(false);
    expect(payload.operation).toBe('create');
    expect(payload.approvalToken).toBeTruthy();
    expect(payload.duplicatesError ?? null).toBeNull();
  });

  it('tempo_preview_worklog does not issue a token when validation fails', async () => {
    const { handlers } = setup({
      tempoRoutes: [emptyWorklogsRoute],
      jiraRoutes: jiraIssueRoutes,
    });
    const { payload } = await call(handlers, 'tempo_preview_worklog', {
      operation: 'create',
      issueKey: 'ABC-1',
      date: '2026-10-28',
      durationMinutes: 90,
      description: '   ',
    });
    expect(payload.approvalToken).toBeUndefined();
    expect((payload.validation as { errors: string[] }).errors.length).toBeGreaterThan(0);
  });

  it('tempo_validate_worklog reports valid=true and never issues a token', async () => {
    const { handlers } = setup({
      tempoRoutes: [emptyWorklogsRoute],
      jiraRoutes: jiraIssueRoutes,
    });
    const { payload, isError } = await call(handlers, 'tempo_validate_worklog', {
      issueKey: 'ABC-1',
      date: '2026-10-28',
      durationMinutes: 90,
      description: 'Implement feature',
    });
    expect(isError).toBe(false);
    expect(payload.valid).toBe(true);
    expect('approvalToken' in payload).toBe(false);
  });

  it('tempo_check_duplicate reports existing worklogs with confidence', async () => {
    const { handlers } = setup({
      tempoRoutes: [
        {
          urlIncludes: '/4/worklogs',
          respond: () => ({ status: 200, json: { metadata: { count: 1 }, results: [worklogJson()] } }),
        },
      ],
      jiraRoutes: jiraIssueRoutes,
    });
    const { payload, isError } = await call(handlers, 'tempo_check_duplicate', {
      issueKey: 'ABC-1',
      date: '2026-10-28',
      durationMinutes: 90,
      description: 'Implement feature',
    });
    expect(isError).toBe(false);
    expect(payload.existingCount).toBe(1);
    const duplicates = payload.possibleDuplicates as Array<{ confidence: string }>;
    expect(duplicates[0].confidence).toBe('high');
    expect(payload.warning).toMatch(/duplicates/i);
  });

  it('write tools refuse to run when WORKLOG_WRITE_ENABLED is not true', async () => {
    const { handlers } = setup({ writeEnabled: false });
    const created = await call(handlers, 'tempo_create_worklog', {
      issueKey: 'ABC-1',
      date: '2026-10-28',
      durationMinutes: 90,
      description: 'Implement feature',
      approvalToken: 'some-approval-token',
      confirm: true,
    });
    expect(created.isError).toBe(true);
    expect(created.payload).toMatchObject({ code: 'WRITE_DISABLED' });

    const updated = await call(handlers, 'tempo_update_worklog', {
      worklogId: 7,
      changes: { description: 'New text' },
      approvalToken: 'some-approval-token',
      confirm: true,
    });
    expect(updated.isError).toBe(true);
    expect(updated.payload).toMatchObject({ code: 'WRITE_DISABLED' });
  });

  it('tempo_create_worklog runs the full preview → write → verify pipeline end-to-end', async () => {
    const { handlers, allCalls } = setup({
      writeEnabled: true,
      tempoRoutes: [
        {
          urlIncludes: '/4/worklogs/55',
          respond: () => ({ status: 200, json: worklogJson({ tempoWorklogId: 55 }) }),
        },
        {
          urlIncludes: '/4/worklogs',
          method: 'POST',
          respond: () => ({ status: 200, json: worklogJson({ tempoWorklogId: 55 }) }),
        },
        emptyWorklogsRoute,
      ],
      jiraRoutes: jiraIssueRoutes,
    });

    const preview = await call(handlers, 'tempo_preview_worklog', {
      operation: 'create',
      issueKey: 'ABC-1',
      date: '2026-10-28',
      durationMinutes: 90,
      description: 'Implement feature',
    });
    const token = preview.payload.approvalToken as string;
    expect(token).toBeTruthy();

    const write = await call(handlers, 'tempo_create_worklog', {
      issueKey: 'ABC-1',
      date: '2026-10-28',
      durationMinutes: 90,
      description: 'Implement feature',
      approvalToken: token,
      confirm: true,
    });
    expect(write.isError).toBe(false);
    expect(write.payload).toMatchObject({ created: true, verification: 'verified' });
    expect(allCalls().some((c) => c.method === 'POST' && c.url.includes('/4/worklogs'))).toBe(true);
  });

  it('tempo_create_worklog rejects a replayed approval token (single use)', async () => {
    const { handlers } = setup({
      writeEnabled: true,
      tempoRoutes: [
        {
          urlIncludes: '/4/worklogs/55',
          respond: () => ({ status: 200, json: worklogJson({ tempoWorklogId: 55 }) }),
        },
        {
          urlIncludes: '/4/worklogs',
          method: 'POST',
          respond: () => ({ status: 200, json: worklogJson({ tempoWorklogId: 55 }) }),
        },
        emptyWorklogsRoute,
      ],
      jiraRoutes: jiraIssueRoutes,
    });

    const preview = await call(handlers, 'tempo_preview_worklog', {
      operation: 'create',
      issueKey: 'ABC-1',
      date: '2026-10-28',
      durationMinutes: 90,
      description: 'Implement feature',
    });
    const token = preview.payload.approvalToken as string;
    const args = {
      issueKey: 'ABC-1',
      date: '2026-10-28',
      durationMinutes: 90,
      description: 'Implement feature',
      approvalToken: token,
      confirm: true,
    };
    await call(handlers, 'tempo_create_worklog', args);
    const replay = await call(handlers, 'tempo_create_worklog', args);
    expect(replay.isError).toBe(true);
    expect(replay.payload).toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('tempo_update_worklog applies approved changes end-to-end', async () => {
    const { handlers } = setup({
      writeEnabled: true,
      tempoRoutes: [
        {
          urlIncludes: '/4/worklogs/7',
          method: 'GET',
          respond: () => ({ status: 200, json: worklogJson() }),
        },
        {
          urlIncludes: '/4/worklogs/7',
          method: 'PUT',
          respond: () => ({
            status: 200,
            json: worklogJson({ description: 'Rewritten description' }),
          }),
        },
      ],
      jiraRoutes: jiraIssueRoutes,
    });

    const preview = await call(handlers, 'tempo_preview_worklog', {
      operation: 'update',
      worklogId: 7,
      changes: { description: 'Rewritten description' },
    });
    const token = preview.payload.approvalToken as string;
    expect(token).toBeTruthy();

    const write = await call(handlers, 'tempo_update_worklog', {
      worklogId: 7,
      changes: { description: 'Rewritten description' },
      approvalToken: token,
      confirm: true,
    });
    expect(write.isError).toBe(false);
    expect(write.payload).toMatchObject({ updated: true, verification: 'verified' });
    const before = write.payload.before as { description?: string };
    expect(before.description).toBe('Implement feature');
  });

  it('tempo_get_week_summary aggregates recorded worklogs by day and issue', async () => {
    const { handlers } = setup({
      tempoRoutes: [
        {
          urlIncludes: '/4/worklogs/user/test-account-id',
          respond: () => ({
            status: 200,
            json: {
              metadata: { count: 2 },
              results: [
                worklogJson({ tempoWorklogId: 1, timeSpentSeconds: 3600 }),
                worklogJson({ tempoWorklogId: 2, timeSpentSeconds: 1800 }),
              ],
            },
          }),
        },
      ],
      jiraRoutes: jiraIssueRoutes,
    });
    const { payload, isError } = await call(handlers, 'tempo_get_week_summary', {
      date: '2026-10-28',
    });
    expect(isError).toBe(false);
    expect(payload.authorScope).toBe('test-account-id');
    expect(payload.totalSeconds).toBe(5400);
    expect(payload.totalFormatted).toBe('1h 30m');
    const issues = payload.issues as Array<Record<string, unknown>>;
    expect(issues[0].issueKey).toBe('ABC-1');
  });
});

