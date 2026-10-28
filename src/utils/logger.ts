import { AppError, ErrorCode } from './errors.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Minimal structured logger that always writes to stderr.
 * MCP stdio transport reserves stdout for protocol messages; never log to stdout.
 */
export class Logger {
  private readonly threshold: number;

  constructor(level: LogLevel = 'info') {
    this.threshold = LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.info;
  }

  private emit(level: LogLevel, message: string, details?: unknown): void {
    if (LEVEL_WEIGHT[level] < this.threshold) return;
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      message,
    };
    if (details !== undefined) entry.details = details;
    process.stderr.write(`${JSON.stringify(entry)}\n`);
  }

  debug(message: string, details?: unknown): void {
    this.emit('debug', message, details);
  }
  info(message: string, details?: unknown): void {
    this.emit('info', message, details);
  }
  warn(message: string, details?: unknown): void {
    this.emit('warn', message, details);
  }
  error(message: string, details?: unknown): void {
    this.emit('error', message, details);
  }
}

/**
 * Convert any thrown value into a structured payload for MCP tool error results.
 * Never includes credentials; only status, code, message, and safe details.
 */
export function toErrorPayload(error: unknown): {
  isError: true;
  code: ErrorCode;
  status?: number;
  message: string;
  details?: unknown;
} {
  if (error instanceof AppError) {
    return {
      isError: true,
      code: error.code,
      ...(error.status !== undefined ? { status: error.status } : {}),
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, code: 'INTERNAL_ERROR', message };
}
