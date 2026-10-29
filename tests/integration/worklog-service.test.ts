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

const PROPOSAL = {
  issueKey: 'ABC-1',
  date: '2026-10-28',
  durationMinutes: 90,
  description: 'Implement feature',
};

function makeService(opts?: {
  writeEnabled?: boolean;
  tempoRoutes?: Parameters<typeof mockFetch>[0];
  jiraRoutes?: Parameters<typeof mockFetch>[0];
}) {
  const tempoMock = mockFetch(opts?.tempoRoutes ?? []);
  const jiraMock = mockFetch(opts?.jiraRoutes ?? opts?.tempoRoutes ?? []);
  const approvals = new ApprovalService();
  const service = new WorklogService({
    tempo: new TempoClient({
      baseUrl: 'https://api.tempo.io',
      token: 't',
      fetchFn: tempoMock.fetchFn,
      logger: silentLogger,
      sleepFn: async () => undefined,
    }),
    jira: new JiraClient({
      baseUrl: 'https://x.atlassian.net',
      email: 'a@b.c',
      apiToken: 't',
      fetchFn: jiraMock.fetchFn,
      logger: silentLogger,
    }),
    approvals,
    config: { timezone: 'UTC', writeEnabled: opts?.writeEnabled ?? false, approvalTtlMs: 60_000, tempoAccountId: 'test-account-id' },
    logger: silentLogger,
  });
  return { service, approvals, calls: [...tempoMock.calls, ...jiraMock.calls] };
}

const emptyWorklogsRoute = {
  urlIncludes: '/4/worklogs',
  method: 'GET',
  respond: () => ({ status: 200, json: { metadata: { count: 0 }, results: [] } }),
};

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
];

describe('WorklogService', () => {
  it('previewCreate resolves the issue, validates and returns an approval token', async () => {
    const { service } = makeService({
      jiraRoutes: jiraIssueRoutes,
      tempoRoutes: [emptyWorklogsRoute],
    });

    const preview = await service.previewCreate(PROPOSAL);
    expect(preview.operation).toBe('create');
    expect(preview.proposal?.issueId).toBe(10001);
    expect(preview.proposal?.timeSpentSeconds).toBe(5400);
    expect(preview.validation.errors).toHaveLength(0);
    expect(preview.approvalToken).toBeTruthy();
  });

  it('createWorklog is refused when writes are disabled', async () => {
    const { service } = makeService({});
    // The service gate is a ConfigError; the tool layer maps it to the WRITE_DISABLED error code.
    await expect(
      service.createWorklog({ ...PROPOSAL, approvalToken: 'any-token-value' }),
    ).rejects.toThrow(/Write operations are disabled/);
  });

  it('createWorklog requires a valid approval token', async () => {
    const { service } = makeService({ writeEnabled: true, jiraRoutes: jiraIssueRoutes });
    await expect(
      service.createWorklog({ ...PROPOSAL, approvalToken: 'bogus-token-123' }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('any payload change invalidates the previous approval', async () => {
    const { service } = makeService({
      writeEnabled: true,
      jiraRoutes: jiraIssueRoutes,
      tempoRoutes: [
        emptyWorklogsRoute,
        {
          urlIncludes: '/4/worklogs',
          method: 'POST',
          respond: () => ({
            status: 200,
            json: {
              tempoWorklogId: 7,
              issue: { id: 10001 },
              timeSpentSeconds: 5400,
              startDate: '2026-10-28',
            },
          }),
        },
      ],
    });

    const preview = await service.previewCreate(PROPOSAL);
    expect(preview.approvalToken).toBeTruthy();
    const token = preview.approvalToken as string;

    // Same token, but the user changed the description after approval -> rejected.
    await expect(
      service.createWorklog({
        ...PROPOSAL,
        description: 'Changed description',
        approvalToken: token,
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('createWorklog succeeds with a matching approval and verifies the result', async () => {
    const { service } = makeService({
      writeEnabled: true,
      tempoRoutes: [
        {
          urlIncludes: '/4/worklogs?from',
          respond: () => ({ status: 200, json: { metadata: { count: 0 }, results: [] } }),
        },
        {
          urlIncludes: '/4/worklogs',
          method: 'POST',
          respond: () => ({
            status: 200,
            json: {
              tempoWorklogId: 42,
              issue: { id: 10001 },
              timeSpentSeconds: 5400,
              startDate: '2026-10-28',
              description: 'Implement feature',
            },
          }),
        },
        {
          urlIncludes: '/4/worklogs/42',
          respond: () => ({
            status: 200,
            json: {
              tempoWorklogId: 42,
              issue: { id: 10001 },
              timeSpentSeconds: 5400,
              startDate: '2026-10-28',
            },
          }),
        },
      ],
      jiraRoutes: [
        {
          urlIncludes: '/rest/api/3/issue/ABC-1',
          respond: () => ({
            status: 200,
            json: { id: '10001', key: 'ABC-1', fields: { summary: 'S' } },
          }),
        },
      ],
    });

    const preview = await service.previewCreate(PROPOSAL);
    const token = preview.approvalToken as string;
    const outcome = await service.createWorklog({ ...PROPOSAL, approvalToken: token });
    expect(outcome.verification).toBe('verified');
    expect(outcome.worklog.tempoWorklogId).toBe(42);
  });

  it('reports UNCERTAIN_OUTCOME when the create times out and does not retry', async () => {
    const { service } = makeService({
      writeEnabled: true,
      tempoRoutes: [
        // Duplicate check (GET) succeeds; the write itself fails unreliably.
        emptyWorklogsRoute,
        {
          urlIncludes: '/4/worklogs',
          method: 'POST',
          respond: () => {
            throw new DOMException('The operation was aborted', 'TimeoutError');
          },
        },
      ],
      jiraRoutes: jiraIssueRoutes,
    });

    const preview = await service.previewCreate(PROPOSAL);
    const token = preview.approvalToken as string;

    await expect(
      service.createWorklog({ ...PROPOSAL, approvalToken: token }),
    ).rejects.toMatchObject({ code: 'UNCERTAIN_OUTCOME' });
  });
});
