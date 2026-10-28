import { z } from 'zod';

/**
 * Normalized Jira issue used across services.
 * Parsing of raw Jira responses happens in the Jira client; this schema is the
 * validation boundary for values that cross service layers.
 */
export const jiraIssueSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  summary: z.string().optional(),
  status: z.string().optional(),
  issueType: z.string().optional(),
  projectKey: z.string().optional(),
});

export type JiraIssueNormalized = z.infer<typeof jiraIssueSchema>;
