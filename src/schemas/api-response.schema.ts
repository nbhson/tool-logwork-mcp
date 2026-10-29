import { z } from 'zod';

/**
 * Runtime (zod) schemas for the RAW HTTP responses of the Jira Cloud and
 * Tempo Timesheets endpoints used by the clients. These are the validation
 * boundary between the network and the typed client layer: a response that
 * parses as JSON but has the wrong shape becomes a structured
 * RESPONSE_INVALID AppError instead of silently flowing through the app.
 *
 * Unknown keys are stripped (zod default), so the parsed value stays
 * compatible with the existing `JiraIssueRaw` / `TempoWorklog` shapes.
 */

// ---------------------------------------------------------------------------
// Jira Cloud REST API v3
// ---------------------------------------------------------------------------

export const jiraIssueRawSchema = z.object({
  id: z.string(),
  key: z.string(),
  fields: z
    .object({
      summary: z.string().optional(),
      status: z.object({ name: z.string().optional() }).optional(),
      issuetype: z.object({ name: z.string().optional() }).optional(),
      project: z.object({ key: z.string().optional() }).optional(),
    })
    .optional(),
});

export const jiraEnhancedSearchResponseSchema = z.object({
  issues: z.array(jiraIssueRawSchema).optional(),
  nextPageToken: z.string().optional(),
  isLast: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Tempo Timesheets REST API v4
// ---------------------------------------------------------------------------

export const tempoWorklogSchema = z.object({
  tempoWorklogId: z.number(),
  issue: z.object({ id: z.number(), self: z.string().optional() }),
  timeSpentSeconds: z.number(),
  billableSeconds: z.number().optional(),
  startDate: z.string(),
  startTime: z.string().optional(),
  startDateTimeUtc: z.string().optional(),
  description: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  author: z.object({ accountId: z.string(), self: z.string().optional() }).nullable().optional(),
  attributes: z
    .object({
      values: z.array(z.object({ key: z.string(), value: z.unknown() })).optional(),
    })
    .nullable()
    .optional(),
});

export const tempoWorklogPageSchema = z.object({
  metadata: z.object({
    count: z.number().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    next: z.string().nullable().optional(),
    previous: z.string().nullable().optional(),
  }),
  results: z.array(tempoWorklogSchema),
});
