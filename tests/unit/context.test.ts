import { describe, expect, it } from 'vitest';
import {
  issueKeyOrId,
  jsonHandler,
  requireJiraClient,
  requireTempoClient,
  truncationFlag,
  truncationNote,
  type ToolContext,
} from '../../src/tools/context.js';
import { ConfigError, NotFoundError, ValidationError } from '../../src/utils/errors.js';
import { loadConfig } from '../../src/config/env.js';
import type { Logger } from '../../src/utils/logger.js';

const silentLogger: Pick<Logger, 'info' | 'warn' | 'error'> = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const config = loadConfig({ env: { TEMPO_API_TOKEN: 't' } as NodeJS.ProcessEnv });
  return {
    config,
    tempo: null,
    jira: null,
    worklogService: {} as ToolContext['worklogService'],
    approvals: {} as ToolContext['approvals'],
    logger: silentLogger as Logger,
    ...overrides,
  };
}

describe('requireTempoClient / requireJiraClient', () => {
  it('returns the client when configured', () => {
    const tempo = { tag: 'tempo' } as unknown as ToolContext['tempo'];
    const jira = { tag: 'jira' } as unknown as ToolContext['jira'];
    const ctx = makeContext({ tempo, jira });
    expect(requireTempoClient(ctx)).toBe(tempo);
    expect(requireJiraClient(ctx)).toBe(jira);
  });

  it('throws an actionable ConfigError when not configured', () => {
    const ctx = makeContext({});
    expect(() => requireTempoClient(ctx)).toThrow(ConfigError);
    expect(() => requireTempoClient(ctx)).toThrow(/TEMPO_API_TOKEN/);
    expect(() => requireJiraClient(ctx)).toThrow(ConfigError);
    expect(() => requireJiraClient(ctx)).toThrow(/JIRA_BASE_URL/);
  });
});

describe('issueKeyOrId', () => {
  it('prefers the resolved key and falls back to issue-<id>', () => {
    const map = new Map([[10001, 'ABC-1']]);
    expect(issueKeyOrId(map, 10001)).toBe('ABC-1');
    expect(issueKeyOrId(map, 20002)).toBe('issue-20002');
  });
});

describe('truncationFlag / truncationNote', () => {
  it('flags when the result set hits the cap', () => {
    expect(truncationFlag(500, 500)).toBe(true);
    expect(truncationFlag(499, 500)).toBe(false);
  });

  it('returns a note only when truncated', () => {
    expect(truncationNote(500, 500)).toMatch(/500-item cap/);
    expect(truncationNote(3, 500)).toBeUndefined();
  });
});

describe('jsonHandler', () => {
  it('serializes the handler result as JSON text content', async () => {
    const handler = jsonHandler(async (args: { value: number }) => ({ doubled: args.value * 2 }));
    const result = await handler({ value: 21 });
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)).toEqual({ doubled: 42 });
  });

  it('maps AppError to a structured isError payload instead of throwing', async () => {
    const handler = jsonHandler(async () => {
      throw new NotFoundError('worklog 42 not found');
    });
    const result = await handler(undefined);
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(payload).toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'worklog 42 not found' });
  });

  it('maps AppError subclasses to their structured code', async () => {
    const handler = jsonHandler(async () => {
      throw new ValidationError('bad input');
    });
    const result = await handler(undefined);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
