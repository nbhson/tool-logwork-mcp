import { describe, expect, it } from 'vitest';
import { TempoClient } from '../../src/clients/tempo-client.js';
import { mockFetch } from '../helpers/mock-fetch.js';

const BASE = 'https://api.tempo.io';

function client(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  return new TempoClient({
    baseUrl: BASE,
    token: 'test-token',
    fetchFn,
    logger: silentLogger,
    maxRetries: 2,
    sleepFn: async () => undefined,
  });
}

const silentLogger = { debug: () => undefined, warn: () => undefined };

function worklog(id: number, date = '2026-10-26', seconds = 3600, issueId = 100) {
  return {
    tempoWorklogId: id,
    issue: { id: issueId },
    timeSpentSeconds: seconds,
    startDate: date,
    description: 'work',
    author: { accountId: 'acc-1' },
  };
}

describe('TempoClient (mocked HTTP)', () => {
  it('sends Bearer auth and follows pagination', async () => {
    const { fetchFn, calls } = mockFetch([
      {
        urlIncludes: '/4/worklogs',
        respond: ({ url }) => {
          const offset = new URL(url).searchParams.get('offset') ?? '0';
          if (offset === '0') {
            return {
              status: 200,
              json: {
                metadata: { count: 2, limit: 1, offset: 0, next: `${BASE}/4/worklogs?offset=1` },
                results: [worklog(1)],
              },
            };
          }
          return {
            status: 200,
            json: { metadata: { count: 2 }, results: [worklog(2, '2026-10-27', 7200)] },
          };
        },
      },
    ]);
    const c = client(fetchFn);

    const result = await c.getWorklogs({ from: '2026-10-26', to: '2026-10-27' });
    expect(result).toHaveLength(2);
    expect(result[0]?.tempoWorklogId).toBe(1);
    expect(result[1]?.tempoWorklogId).toBe(2);
    // First call carried the Bearer token and query params.
    expect(calls[0]?.headers['Authorization']).toBe('Bearer test-token');
    expect(calls[0]?.url).toContain('from=2026-10-26');
  });

  it('maps 401 to AuthError', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/worklogs',
        respond: () => ({ status: 401, json: { errors: [{ message: 'bad token' }] } }),
      },
    ]);
    const c = client(fetchFn);
    await expect(c.getWorklogs({ from: '2026-10-26', to: '2026-10-26' })).rejects.toMatchObject({
      code: 'AUTH_ERROR',
      status: 401,
    });
  });

  it('retries GET on 429 and honors Retry-After', async () => {
    let n = 0;
    const { fetchFn, calls } = mockFetch([
      {
        urlIncludes: '/worklogs',
        respond: () => {
          n++;
          if (n === 1) return { status: 429, json: {}, headers: { 'Retry-After': '0' } };
          return { status: 200, json: { metadata: { count: 0 }, results: [] } };
        },
      },
    ]);
    const c = client(fetchFn);
    const result = await c.getWorklogs({ from: '2026-10-26', to: '2026-10-26' });
    expect(result).toHaveLength(0);
    expect(calls.length).toBe(2); // initial + 1 retry
  });

  it('does NOT retry a timed-out create (uncertain outcome)', async () => {
    const { fetchFn, calls } = mockFetch([
      {
        urlIncludes: '/worklogs',
        method: 'POST',
        respond: () => {
          throw new Error('connection reset');
        },
      },
    ]);
    const c = client(fetchFn);
    await expect(
      c.createWorklog({ issueId: 1, timeSpentSeconds: 3600, startDate: '2026-10-28' }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(calls).toHaveLength(1); // exactly one attempt
  });

  it('maps 404 to NotFoundError for getWorklog', async () => {
    const { fetchFn } = mockFetch([
      { urlIncludes: '/worklogs/', respond: () => ({ status: 404, json: { message: 'nope' } }) },
    ]);
    const c = client(fetchFn);
    await expect(c.getWorklog(999)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('createWorklog posts the v4 payload with issueId', async () => {
    const { fetchFn, calls } = mockFetch([
      {
        urlIncludes: '/worklogs',
        method: 'POST',
        respond: () => ({
          status: 200,
          json: {
            tempoWorklogId: 42,
            issue: { id: 100 },
            timeSpentSeconds: 3600,
            startDate: '2026-10-28',
          },
        }),
      },
    ]);
    const c = client(fetchFn);
    const result = await c.createWorklog({
      issueId: 100,
      timeSpentSeconds: 3600,
      startDate: '2026-10-28',
      description: 'x',
    });
    expect(result.tempoWorklogId).toBe(42);
    const body = JSON.parse(calls[0]?.body ?? '{}') as { issueId: number };
    expect(body.issueId).toBe(100);
  });

  it('getMe reads the caller identity from the author of one worklog', async () => {
    const { fetchFn, calls } = mockFetch([
      {
        urlIncludes: '/4/worklogs',
        respond: () => ({
          status: 200,
          json: { metadata: { count: 1 }, results: [worklog(1, '2026-10-26', 3600, 100)] },
        }),
      },
    ]);
    const c = client(fetchFn);
    const me = await c.getMe();
    expect(me.accountId).toBe('acc-1');
    expect(calls[0]?.url).toContain('limit=1');
  });

  it('getMe returns no accountId when the account has no worklogs', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/worklogs',
        respond: () => ({ status: 200, json: { metadata: { count: 0 }, results: [] } }),
      },
    ]);
    const c = client(fetchFn);
    expect((await c.getMe()).accountId).toBeUndefined();
  });

  it('never returns more results than maxResults, even when a page is larger', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/worklogs',
        respond: () => ({
          status: 200,
          json: {
            metadata: { count: 1000, limit: 1000, offset: 0, next: null },
            results: Array.from({ length: 1000 }, (_, i) => worklog(i + 1)),
          },
        }),
      },
    ]);
    const c = client(fetchFn);
    const result = await c.getWorklogs({ from: '2026-10-26', to: '2026-10-26', maxResults: 200 });
    expect(result).toHaveLength(200);
  });

  it('throws instead of silently truncating when the page guard is exhausted', async () => {
    const { fetchFn } = mockFetch([
      {
        urlIncludes: '/worklogs',
        respond: () => ({
          status: 200,
          json: {
            metadata: { count: 5000 },
            results: [worklog(Math.random())],
          },
        }),
      },
    ]);
    const c = client(fetchFn);
    await expect(
      c.getWorklogs({ from: '2026-10-01', to: '2026-10-31', maxResults: 5000 }),
    ).rejects.toThrow(/pagination guard/);
  });
});
