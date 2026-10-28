import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { jsonHandler, type ToolContext } from '../context.js';
import { validateWorklogInputSchema } from '../../schemas/worklog.schema.js';
import { validateWorklogProposal } from '../../services/validation-service.js';

type ValidateArgs = z.infer<typeof validateWorklogInputSchema>;

/**
 * Validation-only tool: resolves the issue, checks business constraints and
 * returns errors/warnings. Issues NO approval token — approval happens via
 * tempo_preview_worklog. Never writes.
 */
export function registerTempoValidateWorklog(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'tempo_validate_worklog',
    {
      title: 'Validate a worklog proposal',
      description:
        'Validate a proposed worklog: issue existence/access, date, duration, description, and timezone warnings. ' +
        'Returns validation errors and warnings. Does NOT write and does NOT approve anything.',
      inputSchema: validateWorklogInputSchema,
    },
    jsonHandler(async (args: ValidateArgs) => {
      const resolved = await ctx.worklogService.resolveIssue(args.issueKey);
      const validation = validateWorklogProposal({
        issueKey: resolved.issueKey,
        date: args.date,
        durationMinutes: args.durationMinutes,
        description: args.description,
        timezone: ctx.config.timezone,
        issue: { summary: resolved.summary, status: resolved.status },
      });
      return {
        issue: {
          id: String(resolved.issueId),
          key: resolved.issueKey,
          summary: resolved.summary,
          status: resolved.status,
        },
        proposal: {
          issueKey: resolved.issueKey,
          date: args.date,
          durationMinutes: args.durationMinutes,
          timeSpentSeconds: args.durationMinutes * 60,
          description: args.description,
        },
        valid: validation.errors.length === 0,
        ...validation,
        note: 'A successful validation is NOT an approval. Use tempo_preview_worklog to obtain an approval token before any write.',
      };
    }),
  );
}
