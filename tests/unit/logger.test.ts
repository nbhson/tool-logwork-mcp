import { describe, expect, it, vi } from 'vitest';
import { Logger, toErrorPayload } from '../../src/utils/logger.js';
import {
  AppError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from '../../src/utils/errors.js';

function captureStderr(): { lines: () => string[]; restore: () => void } {
  const writes: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  const spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
  return {
    lines: () => writes,
    restore: () => {
      spy.mockRestore();
      void original;
    },
  };
}

describe('Logger', () => {
  it('emits JSON lines to stderr with time, level and message', () => {
    const stderr = captureStderr();
    try {
      const logger = new Logger('info');
      logger.info('hello', { a: 1 });
      const entry = JSON.parse(stderr.lines()[0].trim()) as Record<string, unknown>;
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('hello');
      expect(entry.details).toEqual({ a: 1 });
      expect(typeof entry.time).toBe('string');
    } finally {
      stderr.restore();
    }
  });

  it('suppresses entries below the configured threshold', () => {
    const stderr = captureStderr();
    try {
      const logger = new Logger('warn');
      logger.debug('noisy');
      logger.info('also noisy');
      logger.warn('kept');
      logger.error('kept too');
      expect(stderr.lines()).toHaveLength(2);
      const levels = stderr.lines().map((line) => (JSON.parse(line) as { level: string }).level);
      expect(levels).toEqual(['warn', 'error']);
    } finally {
      stderr.restore();
    }
  });

  it('omits the details field when none is given', () => {
    const stderr = captureStderr();
    try {
      new Logger('debug').debug('plain');
      const entry = JSON.parse(stderr.lines()[0].trim()) as Record<string, unknown>;
      expect(entry.details).toBeUndefined();
    } finally {
      stderr.restore();
    }
  });
});

describe('toErrorPayload', () => {
  it('maps AppError to a structured payload with code and status', () => {
    const payload = toErrorPayload(new NotFoundError('No such worklog'));
    expect(payload).toMatchObject({ isError: true, code: 'NOT_FOUND', status: 404 });
    expect(payload.message).toBe('No such worklog');
  });

  it('omits status when the error has none and includes details when present', () => {
    const payload = toErrorPayload(new ValidationError('bad', { field: 'date' }));
    expect(payload).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      details: { field: 'date' },
    });
    const noStatus = toErrorPayload(new TimeoutError('took too long'));
    expect(noStatus.code).toBe('TIMEOUT');
    expect('status' in noStatus && noStatus.status !== undefined).toBe(false);
  });

  it('keeps retryAfterMs details on rate-limit errors', () => {
    const error = new RateLimitError('slow down', 2000);
    expect(toErrorPayload(error)).toMatchObject({ code: 'RATE_LIMIT', status: 429 });
  });

  it('maps unknown errors to INTERNAL_ERROR without leaking non-Error internals', () => {
    expect(toErrorPayload('boom')).toEqual({
      isError: true,
      code: 'INTERNAL_ERROR',
      message: 'boom',
    });
    expect(toErrorPayload(new Error('plain'))).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'plain',
    });
  });

  it('preserves custom details on a bare AppError', () => {
    const error = new AppError('API_ERROR', 'api broke', 502, { bodySnippet: 'x' });
    expect(toErrorPayload(error).details).toEqual({ bodySnippet: 'x' });
  });
});
