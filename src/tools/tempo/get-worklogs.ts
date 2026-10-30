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
        "By default, results are scoped to the caller's own Tempo account; pass authorAccountId " +
        'to scope to one specific user. Read-only; requires TEMPO_API_TOKEN.',
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

      // Default scope: the caller's own account. Tempo returns every worklog the
      // token can see, so an unfiltered query would silently mix in other users'
      // worklogs on tokens with broad visibility.
      let authorScope: string | null = args.authorAccountId ?? null;
      const notes: string[] = [];
      if (authorScope === null) {
        try {
          authorScope = await ctx.worklogService.getOwnAccountId();
          notes.push(
            "No authorAccountId given; results are scoped to the caller's own Tempo account.",
          );
        } catch {
          notes.push(
            "Could not determine the caller's own account; results are NOT filtered by author " +
              "and may include other users' worklogs. Set TEMPO_ACCOUNT_ID to always scope results.",
          );
        }
      }

      const worklogs = authorScope
        ? await tempo.getWorklogsByUser({
            accountId: authorScope,
            from: args.startDate,
            to: args.endDate,
            maxResults,
          })
        : await tempo.getWorklogs({ from: args.startDate, to: args.endDate, maxResults });

      const keyMap = await ctx.worklogService.resolveIssueKeys(worklogs.map((w) => w.issue.id));

      return {
        range: { startDate: args.startDate, endDate: args.endDate },
        authorScope,
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
        notes,
      };
    }),
  );
}
