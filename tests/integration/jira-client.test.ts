import { describe, expect, it } from 'vitest';
import { JiraClient } from '../../src/clients/jira-client.js';
import { mockFetch } from '../helpers/mock-fetch.js';

const silentLogger = { debug: () => undefined, warn: () => undefined };

function client(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return new JiraClient({
    baseUrl: 'https://x.atlassian.net',
    email: 'me@example.com',
    apiToken: 'tok',
    fetchFn,
    logger: silentLogger,
    sleepFn: async () => undefined,
  });
}

describe('JiraClient (mocked HTTP)', () => {
  it('uses Basic auth and the enhanced search endpoint', async () => {
    const { fetchFn, calls } = mockFetch([
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
                fields: {
                  summary: 'First',
                  status: { name: 'To Do' },
                  issuetype: { name: 'Task' },
                  project: { key: 'ABC' },
                },
              },
            ],
            isLast: true,
          },
        }),
      },
    ]);
    const c = client(fetchFn);
    const result = await c.searchIssues({ jql: 'project = ABC' });

    const expectedAuth = `Basic ${Buffer.from('me@example.com:tok').toString('base64')}`;
    expect(calls[0]?.headers['Authorization']).toBe(expectedAuth);
    expect(calls[0]?.url).toContain('/rest/api/3/search/jql');

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      id: '10001',
      key: 'ABC-1',
      summary: 'First',
      status: 'To Do',
    });
    expect(result.truncated).toBe(false);
  });

  it('follows nextPageToken pagination', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/rest/api/3/search/jql',
        method: 'POST',
        respond: ({ body }) => {
          const parsed = JSON.parse(body ?? '{}') as { nextPageToken?: string };
          if (!parsed.nextPageToken) {
            return {
              status: 200,
              json: { issues: [{ id: '1', key: 'A-1' }], nextPageToken: 'tok2' },
            };
          }
          return { status: 200, json: { issues: [{ id: '2', key: 'A-2' }], isLast: true } };
        },
      },
    ]);
    const c = client(fetchFn);
    const result = await c.searchIssues({ jql: 'project = A', maxResults: 10 });
    expect(result.issues.map((i) => i.key)).toEqual(['A-1', 'A-2']);
  });

  it('getIssue resolves key -> id', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/rest/api/3/issue/ABC-1',
        respond: () => ({
          status: 200,
          json: { id: '10001', key: 'ABC-1', fields: { summary: 'S' } },
        }),
      },
    ]);
    const c = client(fetchFn);
    const issue = await c.getIssue('ABC-1');
    expect(issue.id).toBe('10001');
    expect(issue.key).toBe('ABC-1');
  });

  it('maps 403 to PermissionError', async () => {
    const { fetchFn } = mockFetch([
      { urlIncludes: '/rest/api/3/search/jql', respond: () => ({ status: 403, json: {} }) },
    ]);
    const c = client(fetchFn);
    await expect(c.searchIssues({ jql: 'project = X' })).rejects.toMatchObject({
      code: 'PERMISSION_ERROR',
      status: 403,
    });
  });

  it('maps 400 invalid JQL to ValidationError with body snippet', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/rest/api/3/search/jql',
        respond: () => ({ status: 400, json: { errors: [{ message: 'Invalid JQL' }] } }),
      },
    ]);
    const c = client(fetchFn);
    await expect(c.searchIssues({ jql: 'broken = value' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  });
});
