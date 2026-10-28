import type { ApprovalService } from '../services/approval-service.js';
import type { JiraClient } from '../clients/jira-client.js';
import type { TempoClient } from '../clients/tempo-client.js';
import type { AppConfig } from '../config/env.js';
import { ConfigError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { toErrorPayload } from '../utils/logger.js';
import type { WorklogService } from '../services/worklog-service.js';

/**
 * Shared context handed to every tool registration.
 * Clients may be null when the corresponding credentials are not configured;
 * each tool checks what it needs at call time and returns an actionable error.
 */
export interface ToolContext {
  config: AppConfig;
  tempo: TempoClient | null;
  jira: JiraClient | null;
  worklogService: WorklogService;
  approvals: ApprovalService;
  logger: Logger;
}

export function requireTempoClient(ctx: ToolContext): TempoClient {
  if (!ctx.tempo) {
    throw new ConfigError(
      'TEMPO_API_TOKEN is not configured. Set it in the environment (see .env.example) and restart the server.',
    );
  }
  return ctx.tempo;
}

export function requireJiraClient(ctx: ToolContext): JiraClient {
  if (!ctx.jira) {
    throw new ConfigError(
      'Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN together (see .env.example).',
    );
  }
  return ctx.jira;
}

/** Tempo v4 returns only numeric issue ids; display keys require a Jira lookup. */
export function issueKeyOrId(keyMap: Map<number, string>, issueId: number): string {
  return keyMap.get(issueId) ?? `issue-${issueId}`;
}

export function truncationFlag(count: number, maxResults: number): boolean {
  return count >= maxResults;
}

/**
 * Wraps a tool handler with JSON serialization and structured error reporting.
 * Tool results are returned as JSON text content so every MCP client can read them.
 */
export function jsonHandler<T>(
  handler: (args: T) => Promise<unknown>,
): (args: T) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return async (args: T) => {
    try {
      const result = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const payload = toErrorPayload(error);
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        isError: true,
      };
    }
  };
}

/** Helper used by read tools for honest pagination reporting. */
export function truncationNote(count: number, maxResults: number): string | undefined {
  return truncationFlag(count, maxResults)
    ? `Result set reached the ${maxResults}-item cap; there may be more matching records.`
    : undefined;
}
