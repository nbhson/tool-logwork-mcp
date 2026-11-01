import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
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

const TOOL_NAMES = [
  'tempo_get_worklogs',
  'tempo_get_worklog',
  'jira_search_issues',
  'tempo_get_week_summary',
  'tempo_preview_worklog',
  'tempo_validate_worklog',
  'tempo_check_duplicate',
  'tempo_create_worklog',
  'tempo_update_worklog',
];

function worklogJson(overrides: Record<string, unknown> = {}) {
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
  env?: Record<string, string>;
  tempoRoutes?: Array<{ urlIncludes: string; method?: string; respond: () => unknown }>;
  jiraRoutes?: Array<{ urlIncludes: string; respond: () => unknown }>;
}

/**
 * Builds a REAL McpServer with all tools registered and connects a REAL MCP
 * Client over an in-memory transport pair. Unlike the handler-level tests this
 * exercises the full protocol path: initialization, JSON-RPC framing, schema
 * (de)serialization, and the tool result envelope.
 */
async function setup(opts: SetupOptions = {}) {
  // Empty TEMPO_API_TOKEN means "not configured": mirror index.ts by starting
  // the server anyway with null clients so tools return actionable errors.
  const degraded = (opts.env?.TEMPO_API_TOKEN ?? 'tempo-token') === '';
  const tempoMock = mockFetch(opts.tempoRoutes ?? []);
  const jiraMock = mockFetch(opts.jiraRoutes ?? opts.tempoRoutes ?? []);
  const approvals = new ApprovalService();
  const worklogService = new WorklogService({
    tempo: degraded
      ? null
      : new TempoClient({
          baseUrl: 'https://api.tempo.io',
          token: 'tempo-token',
          fetchFn: tempoMock.fetchFn,
          logger: silentLogger,
          sleepFn: async () => undefined,
        }),
    jira: degraded
      ? null
      : new JiraClient({
          baseUrl: 'https://x.atlassian.net',
          email: 'a@b.c',
          apiToken: 'jira-token',
          fetchFn: jiraMock.fetchFn,
          logger: silentLogger,
        }),
    approvals,
    config: {
      timezone: 'UTC',
      writeEnabled: (opts.env?.WORKLOG_WRITE_ENABLED ?? 'false') === 'true',
      approvalTtlMs: 60_000,
      tempoAccountId: 'test-account-id',
    },
    logger: silentLogger,
  });
  // Mirror index.ts: a config error still starts the server so tools can
  // report the problem as actionable per-call errors.
  let config;
  try {
    config = loadConfig({
      env: {
        TEMPO_API_TOKEN: 'tempo-token',
        ...opts.env,
      } as NodeJS.ProcessEnv,
    });
  } catch {
    // Mirror the fallback config from src/index.ts: the server still starts
    // with null clients so each tool reports the problem as a CONFIG_ERROR.
    config = {
      tempoApiToken: null,
      tempoAccountId: null,
      tempoBaseUrl: 'https://api.tempo.io',
      jiraBaseUrl: null,
      jiraEmail: null,
      jiraApiToken: null,
      logLevel: 'error' as const,
      timezone: 'UTC',
      writeEnabled: false,
    };
  }
  const ctx: ToolContext = {
    config,
    tempo: worklogService['tempo'],
    jira: worklogService['jira'],
    worklogService,
    approvals,
    logger: silentLogger as Logger,
  };

  const server = new McpServer(
    { name: 'tempo-timesheet-mcp', version: '0.0.0-test' },
    { instructions: 'test' },
  );
  registerAllTools(server, ctx);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'protocol-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    allCalls: () => [...tempoMock.calls, ...jiraMock.calls],
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

interface ToolCallOutcome {
  payload: Record<string, unknown>;
  isError: boolean;
}

/** Calls a tool through the real protocol and parses the single text content block. */
async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallOutcome> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  const text = result.content?.[0]?.text ?? '';
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // SDK-generated validation messages are plain text, not JSON.
  }
  return { payload, isError: result.isError === true };
}

describe('MCP protocol-level (real Client over InMemory transport)', () => {
  it('completes initialization and lists all 9 tools with JSON schemas', async () => {
    const { client, cleanup } = await setup();
    try {
      const serverInfo = client.getServerVersion();
      expect(serverInfo?.name).toBe('tempo-timesheet-mcp');
      expect(serverInfo?.version).toBe('0.0.0-test');

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
      for (const tool of tools) {
        expect(tool.description, `${tool.name} should have a description`).toBeTruthy();
        expect(tool.inputSchema).toMatchObject({ type: 'object' });
      }
    } finally {
      await cleanup();
    }
  });

  it('advertises the write-gate fields (approvalToken, confirm) in the create tool schema', async () => {
    const { client, cleanup } = await setup();
    try {
      const { tools } = await client.listTools();
      const create = tools.find((t) => t.name === 'tempo_create_worklog');
      expect(create).toBeDefined();
      const required = (create?.inputSchema as { required?: string[] }).required ?? [];
      expect(required).toEqual(expect.arrayContaining(['approvalToken', 'confirm']));
    } finally {
      await cleanup();
    }
  });

  it('tempo_get_week_summary returns a well-formed result envelope over the wire', async () => {
    const { client, cleanup } = await setup({
      tempoRoutes: [
        {
          urlIncludes: '/4/worklogs/user/test-account-id',
          respond: () => ({
            status: 200,
            json: {
              metadata: { count: 1 },
              results: [worklogJson()],
            },
          }),
        },
      ],
      jiraRoutes: [
        {
          urlIncludes: '/rest/api/3/search/jql',
          respond: () => ({
            status: 200,
            json: { issues: [{ id: '10001', key: 'ABC-1', fields: { summary: 'My issue' } }] },
          }),
        },
      ],
    });
    try {
      const result = (await client.callTool({
        name: 'tempo_get_week_summary',
        arguments: { date: '2026-10-28' },
      })) as { content?: Array<{ type: string; text: string }>; isError?: boolean };
      expect(result.isError).not.toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content?.[0].type).toBe('text');

      const payload = JSON.parse(result.content?.[0].text ?? '{}') as Record<string, unknown>;
      expect(payload.authorScope).toBe('test-account-id');
      expect(payload.totalSeconds).toBe(5400);
      expect(payload.range).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    } finally {
      await cleanup();
    }
  });

  it('tempo_get_worklogs surfaces a structured VALIDATION_ERROR envelope for an inverted range', async () => {
    const { client, cleanup } = await setup();
    try {
      const { payload, isError } = await callTool(client, 'tempo_get_worklogs', {
        startDate: '2026-10-28',
        endDate: '2026-10-01',
      });
      expect(isError).toBe(true);
      expect(payload).toMatchObject({ isError: true, code: 'VALIDATION_ERROR' });
      expect(payload.message).toContain('startDate');
    } finally {
      await cleanup();
    }
  });

  it('rejects schema-invalid arguments as a protocol error result (not a crash)', async () => {
    const { client, cleanup } = await setup();
    try {
      // durationMinutes violates the zod schema (must be a positive integer)
      const { isError, payload } = await callTool(client, 'tempo_validate_worklog', {
        issueKey: 'ABC-1',
        date: '2026-10-28',
        durationMinutes: 'ninety',
        description: 'Implement feature',
      });
      expect(isError).toBe(true);
      expect(payload).toEqual({}); // SDK validation message, not JSON
      const raw = await client.callTool({
        name: 'tempo_validate_worklog',
        arguments: {
          issueKey: 'ABC-1',
          date: '2026-10-28',
          durationMinutes: 'ninety',
          description: 'Implement feature',
        },
      });
      expect(JSON.stringify(raw)).toContain('Invalid arguments for tool');
    } finally {
      await cleanup();
    }
  });

  it('missing credentials surface as a CONFIG_ERROR envelope through the protocol', async () => {
    const { client, cleanup } = await setup({
      env: { TEMPO_API_TOKEN: '' },
    });
    try {
      const { payload, isError } = await callTool(client, 'tempo_get_worklog', { worklogId: 7 });
      expect(isError).toBe(true);
      expect(payload).toMatchObject({ isError: true, code: 'CONFIG_ERROR' });
      expect(payload.message).toContain('TEMPO_API_TOKEN');
    } finally {
      await cleanup();
    }
  });

  it('an unknown tool name raises a protocol-level method-not-found error', async () => {
    const { client, cleanup } = await setup();
    try {
      await expect(
        client.callTool({ name: 'definitely_not_a_tool', arguments: {} }),
      ).rejects.toThrow(/not found/i);
    } finally {
      await cleanup();
    }
  });
});
