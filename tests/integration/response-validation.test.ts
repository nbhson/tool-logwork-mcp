import { describe, expect, it } from 'vitest';
import { JiraClient } from '../../src/clients/jira-client.js';
import { TempoClient } from '../../src/clients/tempo-client.js';
import { mockFetch } from '../helpers/mock-fetch.js';

const silentLogger = { debug: () => undefined, warn: () => undefined };

function jiraClient(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return new JiraClient({
    baseUrl: 'https://x.atlassian.net',
    email: 'me@example.com',
    apiToken: 'tok',
    fetchFn,
    logger: silentLogger,
    sleepFn: async () => undefined,
  });
}

function tempo(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return new TempoClient({
    baseUrl: 'https://api.tempo.io',
    token: 't',
    fetchFn,
    logger: silentLogger,
    sleepFn: async () => undefined,
  });
}

describe('Runtime response validation (zod in BaseClient)', () => {
  it('throws a structured RESPONSE_INVALID error when a Jira issue response has the wrong shape', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/rest/api/3/issue/ABC-1',
        respond: () => ({ status: 200, json: { id: 12345, key: 'ABC-1' } }), // id must be a string
      },
    ]);
    await expect(jiraClient(fetchFn).getIssue('ABC-1')).rejects.toMatchObject({
      code: 'RESPONSE_INVALID',
      name: 'ResponseValidationError',
    });
  });

  it('includes zod issue details in the error', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/rest/api/3/issue/ABC-1',
        respond: () => ({ status: 200, json: { key: 'ABC-1' } }), // missing id
      },
    ]);
    const error = await jiraClient(fetchFn)
      .getIssue('ABC-1')
      .catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe('RESPONSE_INVALID');
    const details = (error as { details?: { issues?: Array<{ path: string }> } }).details;
    expect(details?.issues?.some((i) => i.path === 'id')).toBe(true);
  });

  it('rejects a Tempo worklog page with a malformed results array', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/4/worklogs',
        respond: () => ({
          status: 200,
          json: { metadata: { count: 1 }, results: [{ nope: true }] },
        }),
      },
    ]);
    await expect(
      tempo(fetchFn).getWorklogs({ from: '2026-10-26', to: '2026-10-26' }),
    ).rejects.toMatchObject({ code: 'RESPONSE_INVALID' });
  });

  it('rejects a Tempo single-worklog response missing required fields', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/4/worklogs/1',
        respond: () => ({ status: 200, json: { tempoWorklogId: 'not-a-number' } }),
      },
    ]);
    await expect(tempo(fetchFn).getWorklog(1)).rejects.toMatchObject({
      code: 'RESPONSE_INVALID',
    });
  });

  it('still returns valid data when the response matches the schema', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/rest/api/3/issue/ABC-1',
        respond: () => ({
          status: 200,
          json: { id: '10001', key: 'ABC-1', fields: { summary: 'S' }, extra: 'stripped' },
        }),
      },
    ]);
    const issue = await jiraClient(fetchFn).getIssue('ABC-1');
    expect(issue.id).toBe('10001');
  });

  it('does not require a schema: requests without one behave as before', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/anything',
        respond: () => ({ status: 200, json: { arbitrary: { shape: true } } }),
      },
    ]);
    const { BaseClient } = await import('../../src/clients/base-client.js');
    class RawClient extends BaseClient {}
    const c = new RawClient({ baseUrl: 'https://api.example.com', fetchFn, logger: silentLogger });
    const result = await c.request<Record<string, unknown>>('/anything');
    expect(result).toEqual({ arbitrary: { shape: true } });
  });
});
