---
description: Log Tempo work for a Jira issue (preview first, write only after approval)
---

Log Tempo work for a Jira issue. Arguments: `$ARGUMENTS` — expected shape
"issueKey date duration description" (e.g. "ABC-123 2026-10-28 2h30m Fixed the
login bug"). If parts are missing, ask for them; never guess the issue key.

1. Parse the arguments into: issueKey, date (default today), duration (accept
   "1h30m", "90m", or "1.5h"), and description (required).
2. Call `tempo_preview_worklog` with flattened create args:
   `{ operation: "create", issueKey, date, durationMinutes, description }`.
3. Present the preview to the user:
   - resolved issue (key, summary, status);
   - date, duration, computed timeSpentSeconds, description;
   - any duplicates found (flag high-confidence ones prominently) and any
     validation warnings.
4. Ask for explicit approval. Do NOT proceed on silence.
5. Only after the user approves, call `tempo_create_worklog` with the SAME
   values, the `approvalToken` from the preview, and `confirm: true`.
6. Report the created worklog id and whether post-write verification
   succeeded. If the write returns UNCERTAIN_OUTCOME, do not retry — check
   `tempo_get_worklogs` for that date and report what you find.
