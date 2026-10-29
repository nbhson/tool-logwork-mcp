#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { jiraConfigured, loadConfig } from './config/env.js';
import type { AppConfig } from './config/env.js';
import { DEFAULTS } from './config/constants.js';
import { SERVER_VERSION } from './config/version.js';
import { JiraClient } from './clients/jira-client.js';
import { TempoClient } from './clients/tempo-client.js';
import { ApprovalService } from './services/approval-service.js';
import { WorklogService } from './services/worklog-service.js';
import { registerAllTools } from './tools/register.js';
import { Logger } from './utils/logger.js';

/**
 * Entry point for the Tempo Timesheet MCP Server (stdio transport).
 *
 * IMPORTANT: stdout is reserved for the MCP protocol. All application logging
 * goes to stderr via Logger.
 */
async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig({ env: process.env });
  } catch (error) {
    const logger = new Logger('error');
    logger.error('Configuration error', {
      message: error instanceof Error ? error.message : String(error),
    });
    // Still start the server so clients can discover tools and receive the
    // configuration error as an actionable response per tool call.
    config = {
      tempoApiToken: null,
      tempoBaseUrl: 'https://api.tempo.io',
      jiraBaseUrl: null,
      jiraEmail: null,
      jiraApiToken: null,
      logLevel: 'info' as const,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      writeEnabled: false,
    };
  }

  const logger = new Logger(config.logLevel);
  logger.info('Starting tempo-mcp (stdio)', {
    writeEnabled: config.writeEnabled,
    timezone: config.timezone,
    tempoConfigured: config.tempoApiToken !== null,
    jiraConfigured: jiraConfigured(config),
  });

  const tempo = config.tempoApiToken
    ? new TempoClient({
        baseUrl: config.tempoBaseUrl,
        token: config.tempoApiToken,
        logger,
      })
    : null;

  const jira =
    config.jiraBaseUrl && config.jiraEmail && config.jiraApiToken
      ? new JiraClient({
          baseUrl: config.jiraBaseUrl,
          email: config.jiraEmail,
          apiToken: config.jiraApiToken,
          logger,
        })
      : null;

  const approvals = new ApprovalService();
  const worklogService = new WorklogService({
    tempo,
    jira,
    approvals,
    config: {
      timezone: config.timezone,
      writeEnabled: config.writeEnabled,
      approvalTtlMs: DEFAULTS.approvalTtlMs,
    },
    logger,
  });

  const server = new McpServer(
    {
      name: 'tempo-timesheet-mcp',
      version: SERVER_VERSION,
    },
    {
      instructions:
        'Tempo Timesheets MCP server. Read tools are safe. Writes (tempo_create_worklog / tempo_update_worklog) ' +
        'require WORKLOG_WRITE_ENABLED=true, confirm=true, and an approvalToken from tempo_preview_worklog. ' +
        'Always show a preview and wait for explicit user approval before any write.',
    },
  );

  registerAllTools(server, { config, tempo, jira, worklogService, approvals, logger });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('tempo-mcp connected over stdio');
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
