import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { jsonHandler, type ToolContext } from '../context.js';
import { previewWorklogInputSchema, type WorklogProposal } from '../../schemas/worklog.schema.js';

type PreviewArgs = z.infer<typeof previewWorklogInputSchema>;

/**
 * Preview tool: validates the proposal (create or update), checks duplicates,
 * and returns an approval token bound to the exact payload.
 * NEVER writes anything. A successful validation is NOT an approval.
 *
 * NOTE: OpenCode sometimes flattens zod discriminated unions, so we accept both:
 *   - { operation: "create", proposal: { issueKey, date, ... } }  (spec)
 *   - { operation: "create", issueKey, date, durationMinutes, description }  (flattened)
 */
export function registerTempoPreviewWorklog(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'tempo_preview_worklog',
    {
      title: 'Preview a worklog (no write)',
      description:
        'Prepare a proposed worklog for user review WITHOUT writing to Tempo. ' +
        'operation="create": pass issueKey, date, durationMinutes, description. ' +
        'operation="update": pass worklogId and changes {description?, timeSpentSeconds?, startDate?, startTime?}. ' +
        'Returns validation results, duplicates, and (when valid) an approvalToken required by the write tools. ' +
        'Show the full preview to the user and wait for explicit approval before calling a write tool.',
      inputSchema: previewWorklogInputSchema,
    },
    jsonHandler(async (args: PreviewArgs) => {
      if (args.operation === 'create') {
        // Handle OpenCode's flattened schema: proposal fields at top level
        const proposal =
          args.proposal ??
          ({
            issueKey: args.issueKey,
            date: args.date,
            durationMinutes: args.durationMinutes,
            description: args.description,
            startTime: args.startTime,
          } as WorklogProposal);
        return ctx.worklogService.previewCreate(proposal);
      }
      return ctx.worklogService.previewUpdate(args.worklogId, args.changes);
    }),
  );
}
