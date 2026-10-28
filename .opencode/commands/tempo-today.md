---
description: Summarize today's logged Tempo work
---

Summarize my Tempo worklog for today ($ARGUMENTS overrides the date; a date in
YYYY-MM-DD is also accepted).

1. Determine the target date: use `$ARGUMENTS` if provided, otherwise today in
   the configured timezone.
2. Call `tempo_get_worklogs` for that single date.
3. Report, grouped by Jira issue (resolve issue ids to keys if Jira is
   configured):
   - each issue with its total time (e.g. "ABC-123 — 2h 30m") and a one-line
     description of what was logged;
   - the day total;
   - whether any hours were logged at all.
4. If nothing was logged, say so plainly and offer to log work via
   `tempo_preview_worklog`.

Use recorded worklogs only. Do not speculate about unlogged time unless the
user asks; if you mention gaps, be explicit that these are days/hours without
records.
