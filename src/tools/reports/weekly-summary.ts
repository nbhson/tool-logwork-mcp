import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { jsonHandler, requireTempoClient, type ToolContext } from '../context.js';
import { getWeekSummaryInputSchema } from '../../schemas/worklog.schema.js';
import { todayInTz, weekRangeIso } from '../../utils/date.js';
import { formatDuration } from '../../utils/duration.js';
import { aggregateWorklogs } from '../../services/report-service.js';

export function registerTempoGetWeekSummary(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'tempo_get_week_summary',
    {
      title: 'Weekly timesheet summary',
      description:
        'Aggregate RECORDED Tempo worklogs for one week (Monday..Sunday) by day and by issue. ' +
        'The week is resolved from `date` or `weekStartDate`; defaults to the current week in the configured timezone. ' +
        "By default only the caller's own worklogs are counted (pass authorAccountId to inspect another user). " +
        'Only actually recorded worklogs are counted — missing days are listed as "no recorded worklogs", never as missing work. ' +
        'Read-only; requires TEMPO_API_TOKEN.',
      inputSchema: getWeekSummaryInputSchema,
    },
    jsonHandler(async (args: z.infer<typeof getWeekSummaryInputSchema>) => {
      const anchor = args.weekStartDate ?? args.date ?? todayInTz(ctx.config.timezone);
      const range = weekRangeIso(anchor);

      // Default scope: the caller's own account, so totals never silently mix
      // in other users' worklogs on tokens with broad visibility.
      let authorScope: string | null = args.authorAccountId ?? null;
      const scopeNotes: string[] = [];
      if (authorScope === null) {
        try {
          authorScope = await ctx.worklogService.getOwnAccountId();
        } catch {
          scopeNotes.push(
            "Could not determine the caller's own account; the summary is NOT filtered by author " +
              "and may include other users' worklogs. Set TEMPO_ACCOUNT_ID to always scope results.",
          );
        }
      }

      const tempo = requireTempoClient(ctx);
      const worklogs = authorScope
        ? await tempo.getWorklogsByUser({
            accountId: authorScope,
            from: range.start,
            to: range.end,
          })
        : await tempo.getWorklogs({ from: range.start, to: range.end });

      const keyMap = await ctx.worklogService.resolveIssueKeys(worklogs.map((w) => w.issue.id));
      const summary = aggregateWorklogs(worklogs, {
        from: range.start,
        to: range.end,
        issueKeyById: keyMap,
      });

      const daysWithoutWorklogs = summary.days
        .filter((d) => d.totalSeconds === 0)
        .map((d) => d.date);

      return {
        range: summary.range,
        authorScope,
        totalSeconds: summary.totalSeconds,
        totalFormatted: formatDuration(Math.round(summary.totalSeconds / 60)),
        days: summary.days.map((d) => ({
          date: d.date,
          totalFormatted: formatDuration(Math.round(d.totalSeconds / 60)),
          totalSeconds: d.totalSeconds,
          issues: d.issues.map((i) => ({
            issueId: i.issueId,
            issueKey: i.issueKey ?? keyMap.get(i.issueId) ?? null,
            totalSeconds: i.totalSeconds,
            totalFormatted: formatDuration(Math.round(i.totalSeconds / 60)),
          })),
        })),
        issues: summary.issues.map((i) => ({
          issueId: i.issueId,
          issueKey: i.issueKey ?? null,
          totalFormatted: formatDuration(Math.round(i.totalSeconds / 60)),
          totalSeconds: i.totalSeconds,
        })),
        daysWithoutRecordedWorklogs: daysWithoutWorklogs,
        notes: [
          ...scopeNotes,
          'All figures are RECORDED worklogs only. Days without records may be days off, holidays, or unlogged work — the server cannot tell; ask the user.',
          ...(summary.totalSeconds === 0
            ? ['No worklogs were found for this week within the queried scope.']
            : []),
        ],
      };
    }),
  );
}
