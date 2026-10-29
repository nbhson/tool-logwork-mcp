import { LOG_LEVELS, DEFAULTS } from './constants.js';
import { ConfigError } from '../utils/errors.js';
import type { LogLevel } from '../utils/logger.js';
import { assertValidTimezone } from '../utils/date.js';

export interface AppConfig {
  tempoApiToken: string | null;
  /** Explicit Tempo account ID to use for write operations (when auto-detection fails). */
  tempoAccountId: string | null;
  tempoBaseUrl: string;
  jiraBaseUrl: string | null;
  jiraEmail: string | null;
  jiraApiToken: string | null;
  logLevel: LogLevel;
  timezone: string;
  writeEnabled: boolean;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
}

/**
 * Loads and validates configuration from environment variables.
 * Throws ConfigError with an actionable message when required values are missing or invalid.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;

  const tempoApiToken = emptyToNull(env.TEMPO_API_TOKEN);
  const tempoAccountId = emptyToNull(env.TEMPO_ACCOUNT_ID);
  const jiraBaseUrl = emptyToNull(env.JIRA_BASE_URL);
  const jiraEmail = emptyToNull(env.JIRA_EMAIL);
  const jiraApiToken = emptyToNull(env.JIRA_API_TOKEN);
  const logLevelRaw = (env.LOG_LEVEL ?? 'info').toLowerCase();
  const timezone =
    emptyToNull(env.DEFAULT_TIMEZONE) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const writeEnabled = parseBool(env.WORKLOG_WRITE_ENABLED, false);

  const errors: string[] = [];

  if (tempoApiToken === null) {
    errors.push('TEMPO_API_TOKEN is required for tempo_* tools.');
  }

  const jiraConfigured = jiraBaseUrl !== null && jiraEmail !== null && jiraApiToken !== null;
  const jiraPartiallyConfigured =
    (jiraBaseUrl !== null || jiraEmail !== null || jiraApiToken !== null) && !jiraConfigured;

  if (jiraPartiallyConfigured) {
    errors.push(
      'Jira is partially configured. JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN must all be set together (they are only required for jira_search_issues and issue resolution).',
    );
  }

  if (!(LOG_LEVELS as readonly string[]).includes(logLevelRaw)) {
    errors.push(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')} (got "${logLevelRaw}").`);
  }

  try {
    assertValidTimezone(timezone);
  } catch {
    errors.push(`DEFAULT_TIMEZONE "${timezone}" is not a valid IANA timezone.`);
  }

  if (errors.length > 0) {
    throw new ConfigError(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }

  return {
    tempoApiToken,
    tempoAccountId,
    tempoBaseUrl: (emptyToNull(env.TEMPO_BASE_URL) ?? DEFAULTS.tempoBaseUrl).replace(/\/+$/, ''),
    jiraBaseUrl,
    jiraEmail,
    jiraApiToken,
    logLevel: logLevelRaw as LogLevel,
    timezone,
    writeEnabled,
  };
}

export function jiraConfigured(config: AppConfig): boolean {
  return config.jiraBaseUrl !== null && config.jiraEmail !== null && config.jiraApiToken !== null;
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
