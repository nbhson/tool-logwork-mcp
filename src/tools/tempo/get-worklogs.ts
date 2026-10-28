import type { McpServer } from '@modelcontextprotocol/server';
import {
  issueKeyOrId,
  jsonHandler,
  requireTempoClient,
  truncationFlag,
  truncationNote,
  type ToolContext,
} from '../context.js';
import type { z } from 'zod';
import { getWorklogsInputSchema } from '../../schemas/worklog.schema.js';
import { compareIsoDates } from '../../utils/date.js';
import { ValidationError } from '../../utils/errors.js';

type GetWorklogsArgs = z.infer<typeof getWorklogsInputSchema>;

export function registerTempoGetWorklogs(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'tempo_get_worklogs',
    {
      title: 'Get Tempo worklogs',
      description:
        'Retrieve Tempo worklogs recorded within an inclusive date range (YYYY-MM-DD). ' +
        'Optionally scope to one Jira accountId. Read-only; requires TEMPO_API_TOKEN.',
      inputSchema: getWorklogsInputSchema,
    },
    jsonHandler(async (args: GetWorklogsArgs) => {
      if (compareIsoDates(args.startDate, args.endDate) > 0) {
        throw new ValidationError(
          `startDate (${args.startDate}) must be on or before endDate (${args.endDate}).`,
        );
      }
      const tempo = requireTempoClient(ctx);
      const maxResults = args.maxResults ?? 500;

      const worklogs = args.authorAccountId
        ? await tempo.getWorklogsByUser({
            accountId: args.authorAccountId,
            from: args.startDate,
            to: args.endDate,
            maxResults,
          })
        : await tempo.getWorklogs({ from: args.startDate, to: args.endDate, maxResults });

      const keyMap = await ctx.worklogService.resolveIssueKeys(worklogs.map((w) => w.issue.id));

      return {
        range: { startDate: args.startDate, endDate: args.endDate },
        count: worklogs.length,
        truncated: truncationFlag(worklogs.length, maxResults),
        worklogs: worklogs.map((w) => ({
          tempoWorklogId: w.tempoWorklogId,
          issueId: w.issue.id,
          issueKey: issueKeyOrId(keyMap, w.issue.id),
          startDate: w.startDate,
          startTime: w.startTime ?? null,
          timeSpentMinutes: Math.round(w.timeSpentSeconds / 60),
          timeSpentSeconds: w.timeSpentSeconds,
          description: w.description ?? null,
          authorAccountId: w.author?.accountId ?? null,
          updatedAt: w.updatedAt ?? null,
        })),
        note: truncationNote(worklogs.length, maxResults),
      };
    }),
  );
}
