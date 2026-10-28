import type { McpServer } from '@modelcontextprotocol/server';
import { issueKeyOrId, jsonHandler, requireTempoClient, type ToolContext } from '../context.js';
import { getWorklogInputSchema } from '../../schemas/worklog.schema.js';

export function registerTempoGetWorklog(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'tempo_get_worklog',
    {
      title: 'Get one Tempo worklog',
      description:
        'Retrieve a single Tempo worklog by its tempoWorklogId. Read-only; requires TEMPO_API_TOKEN.',
      inputSchema: getWorklogInputSchema,
    },
    jsonHandler(async (args: { worklogId: number }) => {
      const tempo = requireTempoClient(ctx);
      const worklog = await tempo.getWorklog(args.worklogId);
      const keyMap = await ctx.worklogService.resolveIssueKeys([worklog.issue.id]);
      return {
        tempoWorklogId: worklog.tempoWorklogId,
        issueId: worklog.issue.id,
        issueKey: issueKeyOrId(keyMap, worklog.issue.id),
        startDate: worklog.startDate,
        startTime: worklog.startTime ?? null,
        timeSpentMinutes: Math.round(worklog.timeSpentSeconds / 60),
        timeSpentSeconds: worklog.timeSpentSeconds,
        description: worklog.description ?? null,
        authorAccountId: worklog.author?.accountId ?? null,
        createdAt: worklog.createdAt ?? null,
        updatedAt: worklog.updatedAt ?? null,
      };
    }),
  );
}
