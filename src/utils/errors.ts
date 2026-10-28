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
