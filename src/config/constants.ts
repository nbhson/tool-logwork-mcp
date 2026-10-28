export const DEFAULTS = {
  tempoApiVersion: '4',
  tempoBaseUrl: 'https://api.tempo.io',
  jiraApiVersion: '3',
  /** Conservative page size: Tempo docs disagree between 1000 and 5000 max per call. */
  tempoPageSize: 1000,
  /** Guard against runaway pagination loops. */
  tempoMaxPages: 50,
  jiraPageSize: 50,
  jiraMaxPages: 20,
  httpTimeoutMs: 30_000,
  httpMaxRetries: 2,
  approvalTtlMs: 15 * 60_000,
  maxJqlLength: 500,
  maxDescriptionLength: 4000,
  /** Default cap for read tools so responses stay manageable. */
  defaultMaxResults: 500,
  /** HTTP statuses considered safe to retry with backoff (idempotent requests only). */
  retryableStatuses: [429, 500, 502, 503, 504],
} as const;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
