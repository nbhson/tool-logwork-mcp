import { z } from 'zod';
import { DEFAULTS } from '../config/constants.js';
import { isValidCalendarDate } from '../utils/date.js';
import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES } from '../utils/duration.js';

/** ISO calendar date: YYYY-MM-DD with real calendar validation. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be an ISO calendar date (YYYY-MM-DD).')
  .refine((value) => isValidCalendarDate(value), {
    message: 'Date is not a valid calendar date (YYYY-MM-DD).',
  });

/**
 * Jira issue key (e.g. "SP0168-3839") or numeric issue id ("12345").
 * Either is accepted; resolution to a Tempo issueId happens in the worklog service.
 */
export const issueKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(
    /^([A-Za-z][A-Za-z0-9_]*-\d+|\d+)$/,
    'Issue must be a Jira issue key like "ABC-123" or a numeric issue id.',
  )
  .transform((value) => value.toUpperCase());

export const durationMinutesSchema = z
  .number()
  .int('durationMinutes must be an integer number of minutes')
  .min(MIN_DURATION_MINUTES)
  .max(MAX_DURATION_MINUTES);

export const descriptionSchema = z
  .string()
  .trim()
  .min(1, 'Description is required.')
  .max(DEFAULTS.maxDescriptionLength);

export const startTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'startTime must be HH:mm or HH:mm:ss.');

export const approvalTokenSchema = z.string().min(8).max(128);

// ---------------------------------------------------------------------------
// Tool input schemas
// ---------------------------------------------------------------------------

export const getWorklogsInputSchema = z.object({
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  /** Optional Jira accountId to scope the query to one user (Tempo /worklogs/user/{id}). */
  authorAccountId: z.string().trim().min(1).max(128).optional(),
  maxResults: z.number().int().min(1).max(5000).optional(),
});

export const getWorklogInputSchema = z.object({
  worklogId: z.number().int().positive(),
});

export const searchIssuesInputSchema = z.object({
  jql: z.string().trim().min(1).max(DEFAULTS.maxJqlLength).optional(),
  projectKey: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'projectKey must be a Jira project key.')
    .optional(),
  text: z.string().trim().min(1).max(200).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
});

export const getWeekSummaryInputSchema = z.object({
  /** Any date inside the target week; defaults to today in the configured timezone. */
  date: isoDateSchema.optional(),
  weekStartDate: isoDateSchema.optional(),
  authorAccountId: z.string().trim().min(1).max(128).optional(),
});

/** Proposed worklog payload, shared by preview / validate / duplicate / create tools. */
export const worklogProposalSchema = z.object({
  issueKey: issueKeySchema,
  date: isoDateSchema,
  durationMinutes: durationMinutesSchema,
  description: descriptionSchema,
  startTime: startTimeSchema.optional(),
});

/** Shared alias keys that carry a list of proposals (multi-log support). */
const proposalListSchema = z.array(worklogProposalSchema).min(1).max(50);

export const previewWorklogInputSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('create'),
      proposal: worklogProposalSchema.optional(),
      // Flattened fallback (OpenCode compat): issueKey, date, durationMinutes, description
      issueKey: issueKeySchema.optional(),
      date: isoDateSchema.optional(),
      durationMinutes: durationMinutesSchema.optional(),
      description: descriptionSchema.optional(),
      startTime: startTimeSchema.optional(),
      // Multi-log (batch) aliases: a list of proposals.
      proposals: proposalListSchema.optional(),
      entries: proposalListSchema.optional(),
      items: proposalListSchema.optional(),
      worklogs: proposalListSchema.optional(),
      logs: proposalListSchema.optional(),
      batch: proposalListSchema.optional(),
    })
    .refine(
      (data) => {
        const hasList =
          (data.proposals?.length ?? 0) > 0 ||
          (data.entries?.length ?? 0) > 0 ||
          (data.items?.length ?? 0) > 0 ||
          (data.worklogs?.length ?? 0) > 0 ||
          (data.logs?.length ?? 0) > 0 ||
          (data.batch?.length ?? 0) > 0;
        if (hasList) return true;
        return (
          data.proposal !== undefined ||
          (data.issueKey !== undefined &&
            data.date !== undefined &&
            data.durationMinutes !== undefined &&
            data.description !== undefined)
        );
      },
      {
        message:
          'create: either provide proposal {issueKey, date, durationMinutes, description}, ' +
          'all four flattened fields (issueKey, date, durationMinutes, description), ' +
          'or one of proposals/entries/items/worklogs/logs/batch as a non-empty array.',
      },
    ),
  z.object({
    operation: z.literal('update'),
    worklogId: z.number().int().positive(),
    changes: z
      .object({
        description: descriptionSchema.optional(),
        timeSpentSeconds: z.number().int().min(60).max(86400).optional(),
        startDate: isoDateSchema.optional(),
        startTime: startTimeSchema.optional(),
      })
      .refine((changes) => Object.keys(changes).length > 0, {
        message: 'At least one change is required for an update preview.',
      }),
  }),
]);

export const validateWorklogInputSchema = z.object({
  // single flattened / proposal
  issueKey: issueKeySchema.optional(),
  date: isoDateSchema.optional(),
  durationMinutes: durationMinutesSchema.optional(),
  description: descriptionSchema.optional(),
  startTime: startTimeSchema.optional(),
  proposal: worklogProposalSchema.optional(),
  // multi aliases
  proposals: proposalListSchema.optional(),
  entries: proposalListSchema.optional(),
  items: proposalListSchema.optional(),
  worklogs: proposalListSchema.optional(),
  logs: proposalListSchema.optional(),
  batch: proposalListSchema.optional(),
}).refine(
  (data) => {
    const hasList =
      (data.proposals?.length ?? 0) > 0 ||
      (data.entries?.length ?? 0) > 0 ||
      (data.items?.length ?? 0) > 0 ||
      (data.worklogs?.length ?? 0) > 0 ||
      (data.logs?.length ?? 0) > 0 ||
      (data.batch?.length ?? 0) > 0;
    if (hasList) return true;
    if (data.proposal !== undefined) return true;
    return (
      data.issueKey !== undefined &&
      data.date !== undefined &&
      data.durationMinutes !== undefined &&
      data.description !== undefined
    );
  },
  { message: 'Provide a single proposal or one of proposals/entries/items/worklogs/logs/batch.' },
);

export const checkDuplicateInputSchema = z.object({
  issueKey: issueKeySchema,
  date: isoDateSchema,
  durationMinutes: durationMinutesSchema.optional(),
  description: z.string().trim().max(DEFAULTS.maxDescriptionLength).optional(),
});

export const createWorklogInputSchema = z.object({
  // single flattened / proposal
  issueKey: issueKeySchema.optional(),
  date: isoDateSchema.optional(),
  durationMinutes: durationMinutesSchema.optional(),
  description: descriptionSchema.optional(),
  startTime: startTimeSchema.optional(),
  proposal: worklogProposalSchema.optional(),
  // multi aliases
  proposals: proposalListSchema.optional(),
  entries: proposalListSchema.optional(),
  items: proposalListSchema.optional(),
  worklogs: proposalListSchema.optional(),
  logs: proposalListSchema.optional(),
  batch: proposalListSchema.optional(),
  approvalToken: approvalTokenSchema,
  /** Must be explicitly true; a bare call without confirm is rejected. */
  confirm: z.literal(true),
}).refine(
  (data) => {
    const hasList =
      (data.proposals?.length ?? 0) > 0 ||
      (data.entries?.length ?? 0) > 0 ||
      (data.items?.length ?? 0) > 0 ||
      (data.worklogs?.length ?? 0) > 0 ||
      (data.logs?.length ?? 0) > 0 ||
      (data.batch?.length ?? 0) > 0;
    if (hasList) return true;
    if (data.proposal !== undefined) return true;
    return (
      data.issueKey !== undefined &&
      data.date !== undefined &&
      data.durationMinutes !== undefined &&
      data.description !== undefined
    );
  },
  { message: 'Provide a single proposal or one of proposals/entries/items/worklogs/logs/batch.' },
);

export const updateWorklogInputSchema = z.object({
  worklogId: z.number().int().positive(),
  changes: z
    .object({
      description: descriptionSchema.optional(),
      timeSpentSeconds: z.number().int().min(60).max(86400).optional(),
      startDate: isoDateSchema.optional(),
      startTime: startTimeSchema.optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, {
      message: 'At least one change is required.',
    }),
  approvalToken: approvalTokenSchema,
  confirm: z.literal(true),
});

export type WorklogProposal = z.infer<typeof worklogProposalSchema>;
export type PreviewWorklogInput = z.infer<typeof previewWorklogInputSchema>;
export type CreateWorklogInput = z.infer<typeof createWorklogInputSchema>;
export type UpdateWorklogInput = z.infer<typeof updateWorklogInputSchema>;
