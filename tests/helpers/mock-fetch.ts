export interface MockRoute {
  /** Matches when method matches (or undefined) and url contains `urlIncludes`. */
  urlIncludes: string;
  method?: string;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Respond with a thrown error instead of a response. */
  error?: Error;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface MockFetchResult {
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  calls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
  }>;
}

function headerObject(init: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {};
  const raw = init.headers;
  if (raw instanceof Headers) {
    raw.forEach((value, key) => {
      headers[key] = value;
    });
  } else if (Array.isArray(raw)) {
    for (const [key, value] of raw) headers[key] = value;
  } else if (raw) {
    Object.assign(headers, raw as Record<string, string>);
  }
  return headers;
}

/**
 * Creates an injectable fetch function backed by canned responses.
 * Routes are matched in order; the first matching route wins.
 */
export function mockFetch(
  routes: Array<{
    urlIncludes: string;
    method?: string;
    respond: (call: {
      url: string;
      method: string;
      body: string | null;
    }) =>
      | { status: number; json?: unknown; text?: string; headers?: Record<string, string> }
      | Promise<{
          status: number;
          json?: unknown;
          text?: string;
          headers?: Record<string, string>;
        }>;
  }>,
): MockFetchResult {
  const calls: MockFetchResult['calls'] = [];

  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const call = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: headerObject(init),
      body: typeof init.body === 'string' ? init.body : null,
    };
    calls.push(call);

    const route = routes.find(
      (r) => url.includes(r.urlIncludes) && (r.method === undefined || call.method === r.method),
    );
    if (!route) {
      return new Response(JSON.stringify({ error: `no route matched ${url}` }), {
        status: 599,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const response = await route.respond(call);
    const text =
      response.text ?? (response.json !== undefined ? JSON.stringify(response.json) : '');
    return new Response(text, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', ...(response.headers ?? {}) },
    });
  };

  return { fetchFn, calls };
}

export function jsonHeaders(auth?: string): Record<string, string> {
  return auth
    ? { Accept: 'application/json', Authorization: auth }
    : { Accept: 'application/json' };
}
