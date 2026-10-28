import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { jsonHandler, type ToolContext } from '../context.js';
import { checkDuplicateInputSchema } from '../../schemas/worklog.schema.js';
import { findDuplicates } from '../../services/duplicate-service.js';

type DuplicateArgs = z.infer<typeof checkDuplicateInputSchema>;

/**
 * Duplicate check: compares the proposal with EXISTING recorded worklogs for
 * the same issue and date. Heuristic warnings only — never a uniqueness guarantee.
 * Never writes.
 */
export function registerTempoCheckDuplicate(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'tempo_check_duplicate',
    {
      title: 'Check for duplicate worklogs',
      description:
        'Compare a proposed worklog against existing Tempo worklogs for the same issue and date. ' +
        'Returns possible matches with confidence (high/medium/low) and reasons. ' +
        'Heuristic only — it cannot guarantee uniqueness. Read-only.',
      inputSchema: checkDuplicateInputSchema,
    },
    jsonHandler(async (args: DuplicateArgs) => {
      const resolved = await ctx.worklogService.resolveIssue(args.issueKey);
      const existing = await ctx.worklogService.fetchWorklogsForIssueDate(
        resolved.issueId,
        args.date,
      );
      const duplicates = findDuplicates({
        issueId: resolved.issueId,
        date: args.date,
        durationMinutes: args.durationMinutes,
        description: args.description,
        existingWorklogs: existing,
      });
      return {
        issue: { id: String(resolved.issueId), key: resolved.issueKey, summary: resolved.summary },
        date: args.date,
        existingCount: existing.length,
        possibleDuplicates: duplicates,
        warning:
          duplicates.length > 0 ? 'Possible duplicates found — review before writing.' : null,
        limitation:
          'Only worklogs visible to the configured Tempo token are compared. This heuristic does not guarantee uniqueness.',
      };
    }),
  );
}
