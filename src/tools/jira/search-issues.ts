import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { jsonHandler, requireJiraClient, type ToolContext } from '../context.js';
import { searchIssuesInputSchema } from '../../schemas/worklog.schema.js';
import { DEFAULTS } from '../../config/constants.js';
import { ValidationError } from '../../utils/errors.js';

type SearchIssuesArgs = z.infer<typeof searchIssuesInputSchema>;

/**
 * Builds a JQL string from friendly inputs, or passes validated JQL through.
 * All values are sent inside a JSON POST body to /rest/api/3/search/jql —
 * there is no URL injection surface; quotes in free text are escaped for JQL itself.
 */
function buildJql(args: SearchIssuesArgs): string {
  if (args.jql !== undefined && args.jql.trim().length > 0) {
    if (args.jql.length > DEFAULTS.maxJqlLength) {
      throw new ValidationError(
        `jql exceeds the maximum length of ${DEFAULTS.maxJqlLength} characters.`,
      );
    }
    return args.jql.trim();
  }
  const parts: string[] = [];
  if (args.projectKey !== undefined) parts.push(`project = "${args.projectKey}"`);
  if (args.text !== undefined) parts.push(`text ~ "${escapeJqlText(args.text)}"`);
  return parts.join(' AND ');
}

function escapeJqlText(text: string): string {
  return text.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function registerJiraSearchIssues(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'jira_search_issues',
    {
      title: 'Search Jira issues',
      description:
        'Search Jira issues. Provide either a jql string, or projectKey and/or text (combined with AND). ' +
        'Read-only; requires JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN.',
      inputSchema: searchIssuesInputSchema,
    },
    jsonHandler(async (args: SearchIssuesArgs) => {
      if (!args.jql && !args.projectKey && !args.text) {
        throw new ValidationError(
          'Provide at least one search criterion: jql, projectKey, or text.',
        );
      }
      const jira = requireJiraClient(ctx);
      const jql = buildJql(args);
      const result = await jira.searchIssues({ jql, maxResults: args.maxResults ?? 25 });
      return {
        jql,
        count: result.issues.length,
        truncated: result.truncated,
        issues: result.issues,
        note: args.jql
          ? 'The caller-supplied JQL query was executed as-is.'
          : 'JQL was constructed from the provided filters.',
      };
    }),
  );
}
