import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { jsonHandler, type ToolContext } from '../context.js';
import { previewWorklogInputSchema } from '../../schemas/worklog.schema.js';

type PreviewArgs = z.infer<typeof previewWorklogInputSchema>;

/**
 * Preview tool: validates the proposal (create or update), checks duplicates,
 * and returns an approval token bound to the exact payload.
 * NEVER writes anything. A successful validation is NOT an approval.
 */
export function registerTempoPreviewWorklog(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'tempo_preview_worklog',
    {
      title: 'Preview a worklog (no write)',
      description:
        'Prepare a proposed worklog for user review WITHOUT writing to Tempo. ' +
        'operation="create": pass proposal {issueKey, date, durationMinutes, description, startTime?}. ' +
        'operation="update": pass worklogId and changes {description?, timeSpentSeconds?, startDate?, startTime?}. ' +
        'Returns validation results, duplicates, and (when valid) an approvalToken required by the write tools. ' +
        'Show the full preview to the user and wait for explicit approval before calling a write tool.',
      inputSchema: previewWorklogInputSchema,
    },
    jsonHandler(async (args: PreviewArgs) => {
      if (args.operation === 'create') {
        return ctx.worklogService.previewCreate(args.proposal);
      }
      return ctx.worklogService.previewUpdate(args.worklogId, args.changes);
    }),
  );
}
