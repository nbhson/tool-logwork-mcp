import { loadConfig } from '../../src/config/env.js';
import { describe, expect, it } from 'vitest';

describe('loadConfig', () => {
  it('loads from environment variables', () => {
    const config = loadConfig({
      env: {
        TEMPO_API_TOKEN: 'tok123',
        TEMPO_BASE_URL: 'https://api.tempo.io',
        JIRA_BASE_URL: 'https://x.atlassian.net',
        JIRA_EMAIL: 'me@example.com',
        JIRA_API_TOKEN: 'jira-tok',
        LOG_LEVEL: 'debug',
        DEFAULT_TIMEZONE: 'Asia/Ho_Chi_Minh',
        WORKLOG_WRITE_ENABLED: 'true',
      },
    });
    expect(config.tempoApiToken).toBe('tok123');
    expect(config.tempoBaseUrl).toBe('https://api.tempo.io');
    expect(config.writeEnabled).toBe(true);
    expect(config.logLevel).toBe('debug');
    expect(config.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(config.jiraBaseUrl).toBe('https://x.atlassian.net');
    expect(config.jiraEmail).toBe('me@example.com');
  });

  it('requires TEMPO_API_TOKEN', () => {
    expect(() =>
      loadConfig({
        env: { TEMPO_API_TOKEN: '', JIRA_BASE_URL: '', JIRA_EMAIL: '', JIRA_API_TOKEN: '' },
      }),
    ).toThrow(/TEMPO_API_TOKEN/);
  });

  it('rejects invalid LOG_LEVEL', () => {
    expect(() => loadConfig({ env: { TEMPO_API_TOKEN: 'tok', LOG_LEVEL: 'invalid' } })).toThrow(
      /LOG_LEVEL/,
    );
  });

  it('rejects invalid timezone', () => {
    expect(() =>
      loadConfig({ env: { TEMPO_API_TOKEN: 'tok', DEFAULT_TIMEZONE: 'Not/Zone' } }),
    ).toThrow(/timezone/i);
  });

  it('rejects partial Jira config', () => {
    expect(() =>
      loadConfig({ env: { TEMPO_API_TOKEN: 'tok', JIRA_BASE_URL: 'https://x.atlassian.net' } }),
    ).toThrow(/Jira/i);
  });

  it('defaults writeEnabled to false', () => {
    const config = loadConfig({ env: { TEMPO_API_TOKEN: 'tok' } });
    expect(config.writeEnabled).toBe(false);
  });

  it('defaults timezone to system timezone', () => {
    const config = loadConfig({ env: { TEMPO_API_TOKEN: 'tok' } });
    expect(config.timezone).toBeTruthy();
  });
});
