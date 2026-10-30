import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { jsonHandler, type ToolContext } from '../context.js';
import { updateWorklogInputSchema } from '../../schemas/worklog.schema.js';
import { WriteDisabledError } from '../../utils/errors.js';

/**
 * Write tool (update). Same gates as create: writes enabled, confirm=true,
 * and an approval token bound to the exact worklogId + changes.
 */
export function registerTempoUpdateWorklog(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'tempo_update_worklog',
    {
      title: 'Update a Tempo worklog (write, gated)',
      description:
        'Update an existing Tempo worklog after explicit user approval. Requires: writes enabled, ' +
        'confirm=true, and an approvalToken from tempo_preview_worklog (operation="update") for the ' +
        'EXACT same worklogId and changes. No worklog deletion exists in this MVP.',
      inputSchema: updateWorklogInputSchema,
    },
    jsonHandler(async (args: z.infer<typeof updateWorklogInputSchema>) => {
      if (!ctx.config.writeEnabled) {
        throw new WriteDisabledError();
      }
      const outcome = await ctx.worklogService.updateWorklog(args);
      return {
        updated: true,
        verification: outcome.verification,
        worklog: {
          tempoWorklogId: outcome.worklog.tempoWorklogId,
          issueId: outcome.worklog.issue.id,
          startDate: outcome.worklog.startDate,
          timeSpentSeconds: outcome.worklog.timeSpentSeconds,
          description: outcome.worklog.description ?? null,
        },
        before: {
          startDate: outcome.before.startDate,
          timeSpentSeconds: outcome.before.timeSpentSeconds,
          description: outcome.before.description ?? null,
        },
        notes: [
          outcome.verification === 'verified'
            ? 'The updated record was re-read from the Tempo API.'
            : 'WARNING: the update API call succeeded but post-write verification failed; re-read before any further action.',
        ],
      };
    }),
  );
}
