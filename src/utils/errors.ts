/**
 * Application error types with a stable machine-readable `code`, so MCP tools can
 * return structured, actionable errors without leaking credentials.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_ERROR'
  | 'PERMISSION_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'CONFLICT'
  | 'API_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'WRITE_DISABLED'
  | 'APPROVAL_REQUIRED'
  | 'CONFIG_ERROR'
  | 'UNCERTAIN_OUTCOME'
  | 'RESPONSE_INVALID'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status?: number, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class AuthError extends AppError {
  constructor(message: string) {
    super('AUTH_ERROR', message, 401);
  }
}

export class PermissionError extends AppError {
  constructor(message: string) {
    super('PERMISSION_ERROR', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super('NOT_FOUND', message, 404);
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super('RATE_LIMIT', message, 429);
    this.retryAfterMs = retryAfterMs;
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details);
  }
}

export class ApiError extends AppError {
  constructor(message: string, status: number, details?: unknown) {
    super('API_ERROR', message, status, details);
  }
}

export class TimeoutError extends AppError {
  constructor(message: string) {
    super('TIMEOUT', message);
  }
}

export class NetworkError extends AppError {
  constructor(message: string, details?: unknown) {
    super('NETWORK_ERROR', message, undefined, details);
  }
}

export class WriteDisabledError extends AppError {
  constructor(message = 'Write operations are disabled (WORKLOG_WRITE_ENABLED=false).') {
    super('WRITE_DISABLED', message);
  }
}

export class ApprovalRequiredError extends AppError {
  constructor(message: string, details?: unknown) {
    super('APPROVAL_REQUIRED', message, undefined, details);
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super('CONFIG_ERROR', message);
  }
}

export class UncertainOutcomeError extends AppError {
  constructor(message: string, details?: unknown) {
    super('UNCERTAIN_OUTCOME', message, undefined, details);
  }
}

export class InternalError extends AppError {
  constructor(message: string) {
    super('INTERNAL_ERROR', message);
  }
}

/**
 * Thrown when an API response parses as JSON but does not match the expected
 * runtime (zod) schema. Carries the zod issues in `details` for diagnostics.
 */
export class ResponseValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('RESPONSE_INVALID', message, undefined, details);
  }
}

/**
 * Actionable follow-up per error code, surfaced to the model/user in the tool
 * error envelope (`hint`). Keep hints short and imperative; they must never
 * contain credentials.
 */
const ERROR_HINTS: Partial<Record<ErrorCode, string>> = {
  AUTH_ERROR:
    'The API token is missing, expired, or revoked. Generate a fresh token ' +
    '(Tempo: Settings → API Integration; Jira: id.atlassian.com → Security → API tokens), ' +
    'update the environment variable, then restart the server.',
  PERMISSION_ERROR:
    'The token is valid but lacks access. Check the token scopes (Tempo needs the ' +
    'Worklogs scope) and that the account can see the requested issue/user.',
  NOT_FOUND:
    'The id/key does not exist or is not visible to this token. Double-check the ' +
    'worklog id or issue key with a list/search tool first.',
  RATE_LIMIT:
    'Too many requests in a short window. Wait for the suggested interval, then retry; ' +
    'narrow the date range or lower maxResults to reduce call volume.',
  TIMEOUT:
    'The upstream API did not respond in time. Retry the read; for a write, VERIFY the ' +
    'outcome first (tempo_get_worklog) before retrying to avoid duplicates.',
  NETWORK_ERROR:
    'The server could not reach the API. Check network connectivity, VPN, and proxy ' +
    'settings (HTTPS_PROXY), then retry. If using a self-signed proxy, ensure Node trusts the CA.',
  WRITE_DISABLED:
    'Writes are off by default. Set WORKLOG_WRITE_ENABLED=true in the environment and ' +
    'restart the server, then re-run the preview to get a fresh approval token.',
  APPROVAL_REQUIRED:
    'Every write needs a fresh approval token: call tempo_preview_worklog first, show the ' +
    'preview to the user, and pass the token with confirm=true within 15 minutes. ' +
    'Tokens are single-use and invalidated by any change to the payload.',
  CONFIG_ERROR:
    'Server configuration is incomplete or invalid. Compare your environment with ' +
    '.env.example and restart the server after fixing it.',
  VALIDATION_ERROR:
    'Fix the reported input fields (dates as YYYY-MM-DD, duration in whole minutes) and retry.',
  CONFLICT:
    'The resource changed concurrently or duplicates exist. Re-read the worklog, then retry ' +
    'with an updated payload.',
  UNCERTAIN_OUTCOME:
    'The write MAY have been applied. Verify with tempo_get_worklog (or tempo_get_worklogs) ' +
    'before any retry; never blindly repeat the write.',
  RESPONSE_INVALID:
    'The upstream API returned an unexpected shape (contract change or broken proxy). ' +
    'Upgrade the server and check status.atlassian.com for incidents.',
  API_ERROR:
    'The upstream API returned a server-side error. This is usually temporary — retry the ' +
    'read, and check status.atlassian.com if it persists.',
};

/** Returns the actionable hint for an error code, if any. */
export function errorHint(code: ErrorCode): string | undefined {
  return ERROR_HINTS[code];
}
