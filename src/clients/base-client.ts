import { DEFAULTS } from '../config/constants.js';
import type { ZodType } from 'zod';
import { ResponseValidationError } from '../utils/errors.js';
import {
  ApiError,
  AppError,
  AuthError,
  ConflictError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from '../utils/errors.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type HttpMethod = 'GET' | 'POST' | 'PUT';

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, string | number | readonly string[] | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Only idempotent requests are retried on 429/5xx. Writes are never retried automatically. */
  idempotent?: boolean;
  timeoutMs?: number;
}

export interface BaseClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchFn?: FetchLike;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface RetryLogger {
  debug(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
}

export interface PaginatedMetadata {
  count?: number;
  limit?: number;
  offset?: number;
  next?: string | null;
  previous?: string | null;
}

export interface PaginatedResponse<T> {
  results: T[];
  metadata: PaginatedMetadata;
}

const MAX_BODY_SNIPPET = 500;

const defaultLogger: RetryLogger = {
  debug: () => undefined,
  warn: () => undefined,
};

/**
 * Shared HTTP logic for the Tempo and Jira clients:
 * - request timeouts via AbortSignal
 * - retries only for idempotent (GET) requests on 429/5xx, honoring Retry-After
 * - status-code based error mapping with safe messages (never includes credentials)
 * - write requests are never retried automatically
 */
export class BaseClient {
  protected readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly logger: RetryLogger;

  constructor(opts: BaseClientOptions & { logger?: RetryLogger }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.httpTimeoutMs;
    this.maxRetries = opts.maxRetries ?? DEFAULTS.httpMaxRetries;
    this.sleepFn = opts.sleepFn ?? defaultSleep;
    this.logger = opts.logger ?? defaultLogger;
  }

  protected async request<T>(
    path: string,
    options: RequestOptions = {},
    schema?: ZodType<T>,
  ): Promise<T> {
    const method = options.method ?? 'GET';
    const url = this.buildUrl(path, options.query);
    const idempotent = method === 'GET' || options.idempotent === true;
    const maxAttempts = idempotent ? this.maxRetries + 1 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetchWithTimeout(url, method, options);
      } catch (error) {
        // Network errors and timeouts are never retried, especially for writes:
        // the request may already have been processed by the server.
        if (error instanceof TimeoutError) throw error;
        if (this.isAbortTimeout(error)) {
          throw new TimeoutError(
            `Request to ${this.safeUrl(url)} timed out after ${this.timeoutMs}ms.` +
              (method === 'GET'
                ? ''
                : ' The request may or may not have been processed; verify the result before retrying.'),
          );
        }
        throw new NetworkError(
          `Network error calling ${this.safeUrl(url)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      if (response.ok) {
        const parsed = await this.parseJson(response);
        if (schema) return this.validateResponse(parsed, schema, url);
        return parsed as T;
      }

      const shouldRetry =
        idempotent &&
        attempt <= this.maxRetries &&
        (DEFAULTS.retryableStatuses as readonly number[]).includes(response.status);

      if (shouldRetry) {
        const retryAfterMs = this.retryAfterMs(response) ?? this.backoffMs(attempt);
        this.logger.warn('Retrying request', {
          url: this.safeUrl(url),
          status: response.status,
          attempt,
          retryAfterMs,
        });
        await this.sleepFn(retryAfterMs);
        continue;
      }

      throw this.mapStatusError(response, url, await this.safeBody(response));
    }

    throw new ApiError(`Unhandled request state for ${this.safeUrl(url)}`, 500);
  }

  protected buildUrl(path: string, query?: RequestOptions['query']): string {
    let url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) params.append(key, String(item));
        } else {
          params.append(key, String(value));
        }
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }

  private async fetchWithTimeout(
    url: string,
    method: HttpMethod,
    options: RequestOptions,
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return this.fetchFn(url, init);
  }

  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.length === 0) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Some endpoints may return empty bodies on success; treat unparseable 2xx as an API error.
      throw new ApiError(
        `Unexpected non-JSON response from ${this.safeUrl(response.url)}`,
        response.status,
        { bodySnippet: text.slice(0, MAX_BODY_SNIPPET) },
      );
    }
  }

  /**
   * Validates a parsed JSON payload against a zod schema. A mismatch means the
   * API contract changed (or a proxy mangled the response): instead of returning
   * wrongly-shaped data downstream, throw a structured RESPONSE_INVALID error.
   */
  private validateResponse<T>(data: unknown, schema: ZodType<T>, url: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      }));
      throw new ResponseValidationError(
        `Response from ${this.safeUrl(url)} did not match the expected schema ` +
          `(${issues.length} issue${issues.length === 1 ? '' : 's'}; first: ${issues[0]?.path}: ${issues[0]?.message}).`,
        { issues: issues.slice(0, 10) },
      );
    }
    return result.data;
  }

  private mapStatusError(response: Response, url: string, snippet: string): AppError {
    const status = response.status;
    const endpoint = this.safeUrl(url);
    const suffix = snippet ? ` - ${snippet}` : '';
    switch (status) {
      case 400:
        return new ValidationError(`Invalid request to ${endpoint}${suffix}`);
      case 401:
        return new AuthError(`Authentication failed for ${endpoint}. Check the API token.`);
      case 403:
        return new PermissionError(
          `Permission denied for ${endpoint}. Verify the token scope and account permissions.`,
        );
      case 404:
        return new NotFoundError(`Resource not found: ${endpoint}`);
      case 409:
        return new ConflictError(`Conflict for ${endpoint}${suffix}`);
      case 429:
        return new RateLimitError(
          `Rate limit exceeded for ${endpoint}.` +
            (this.retryAfterMs(response)
              ? ` Retry after ~${Math.round((this.retryAfterMs(response) ?? 0) / 1000)}s.`
              : ''),
          this.retryAfterMs(response),
        );
      default:
        if (status >= 500) {
          return new ApiError(`Server error (${status}) from ${endpoint}${suffix}`, status);
        }
        return new ApiError(`Unexpected HTTP ${status} from ${endpoint}${suffix}`, status);
    }
  }

  private async safeBody(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text.slice(0, MAX_BODY_SNIPPET);
    } catch {
      return '';
    }
  }

  private retryAfterMs(response: Response): number | undefined {
    const header = response.headers.get('retry-after');
    if (!header) return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
    return undefined;
  }

  private backoffMs(attempt: number): number {
    return Math.min(8000, 500 * 2 ** (attempt - 1));
  }

  /** Detects Node's AbortSignal timeout errors (DOMException TimeoutError/AbortError). */
  private isAbortTimeout(error: unknown): boolean {
    return (
      error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    );
  }

  /** Redacts query strings (which could contain identifiers) from logged URLs. */
  private safeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url.split('?')[0] ?? url;
    }
  }
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
