---
description: Summarize today's logged Tempo work
---

Summarize my Tempo worklog for today (`$ARGUMENTS` overrides the date; a date in
YYYY-MM-DD is also accepted).

1. Determine the target date: use `$ARGUMENTS` if provided, otherwise today in
   the configured timezone.
2. Call `tempo_get_worklogs` for that single date.
3. Render the result using EXACTLY this layout (plain text, no extra prose):

   ┌─────────────────────────────────────────────
   │ ⏱ TEMPO — Thứ Hai, 2026-10-30
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   ▸ ABC-123 Fix login bug .............. 2h 30m
   "Implemented auth flow and unit tests"
   ▸ ABC-456 Review PR .................. 1h 00m

   ─────────────────────────────────────────────
   ✔ Total: 3h 30m across 2 issues

   Rules for the report:
   - one `▸` line per issue: `<key>  <summary/title>  <time>`;
   - align the time column; use `....` leaders where it improves readability;
   - end with a `───` divider and a `Total` line;
   - if Jira is unavailable and a key shows as `issue-{id}`, display the raw id
     and note that Jira was not reachable for key resolution.

4. If nothing was logged, output the header, then:
   `✖ No worklogs recorded on <date>.` and offer to log work via
   `tempo_preview_worklog`.

Use recorded worklogs only. Do not speculate about unlogged time unless the
user asks; if you mention gaps, be explicit that these are hours without
records.
