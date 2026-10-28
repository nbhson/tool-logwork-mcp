import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext } from './context.js';
import { registerTempoGetWorklogs } from './tempo/get-worklogs.js';
import { registerTempoGetWorklog } from './tempo/get-worklog.js';
import { registerJiraSearchIssues } from './jira/search-issues.js';
import { registerTempoGetWeekSummary } from './reports/weekly-summary.js';
import { registerTempoPreviewWorklog } from './tempo/preview-worklog.js';
import { registerTempoValidateWorklog } from './tempo/validate-worklog.js';
import { registerTempoCheckDuplicate } from './tempo/check-duplicate.js';
import { registerTempoCreateWorklog } from './tempo/create-worklog.js';
import { registerTempoUpdateWorklog } from './tempo/update-worklog.js';

/**
 * Registers every MCP tool implemented by this server.
 * Tools are always registered so clients can discover the full surface;
 * missing credentials surface as actionable errors at call time.
 */
export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  // Read
  registerTempoGetWorklogs(server, ctx);
  registerTempoGetWorklog(server, ctx);
  registerJiraSearchIssues(server, ctx);
  registerTempoGetWeekSummary(server, ctx);
  // Preview / validation
  registerTempoPreviewWorklog(server, ctx);
  registerTempoValidateWorklog(server, ctx);
  registerTempoCheckDuplicate(server, ctx);
  // Write (gated)
  registerTempoCreateWorklog(server, ctx);
  registerTempoUpdateWorklog(server, ctx);
}
