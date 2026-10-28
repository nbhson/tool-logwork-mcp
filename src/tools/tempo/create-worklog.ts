import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { jsonHandler, type ToolContext } from '../context.js';
import { createWorklogInputSchema } from '../../schemas/worklog.schema.js';
import { WriteDisabledError } from '../../utils/errors.js';

type CreateArgs = z.infer<typeof createWorklogInputSchema>;
export type { CreateArgs };

/**
 * Write tool. Safety gates (all must pass):
 * 1. WORKLOG_WRITE_ENABLED=true (otherwise WriteDisabledError).
 * 2. `confirm: true` explicitly present in the input.
 * 3. approvalToken from tempo_preview_worklog, still valid, matching the EXACT
 *    payload (issue, date, duration, description, startTime).
 * On success the created worklog is re-fetched for verification. Uncertain
 * network outcomes are reported as UNCERTAIN_OUTCOME — never auto-retried.
 */
export function registerTempoCreateWorklog(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'tempo_create_worklog',
    {
      title: 'Create a Tempo worklog (write, gated)',
      description:
        'Create a Tempo worklog after explicit user approval. Requires: writes enabled ' +
        '(WORKLOG_WRITE_ENABLED=true), confirm=true, and an approvalToken obtained from ' +
        'tempo_preview_worklog for the EXACT same proposal. Refuses to run without all three. ' +
        'Verifies the created worklog afterwards and reports uncertain outcomes instead of retrying.',
      inputSchema: createWorklogInputSchema,
    },
    jsonHandler(async (args: z.infer<typeof createWorklogInputSchema>) => {
      if (!ctx.config.writeEnabled) {
        throw new WriteDisabledError();
      }
      const outcome = await ctx.worklogService.createWorklog(args);
      return {
        created: true,
        verification: outcome.verification,
        worklog: {
          tempoWorklogId: outcome.worklog.tempoWorklogId,
          issueId: outcome.worklog.issue.id,
          startDate: outcome.worklog.startDate,
          timeSpentSeconds: outcome.worklog.timeSpentSeconds,
          description: outcome.worklog.description ?? null,
        },
        duplicatesAtWriteTime: outcome.duplicates,
        notes: [
          'The worklog was created because a preview approval token matched this exact payload.',
          outcome.verification === 'verified'
            ? 'The result was re-read from the Tempo API and matches.'
            : 'WARNING: the write API call succeeded but post-write verification failed; re-read the worklog before any further action.',
        ],
      };
    }),
  );
}
