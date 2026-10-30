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
3. Present the preview to the user as a confirmation card, EXACTLY:

   ┌─────────────────────────────────────────────
   │ 👁 PREVIEW — create worklog
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Issue ABC-123 — Fix login bug (In Progress)
   Date 2026-10-30
   Duration 2h 30m (9000s)
   Starts at 09:00
   Description
   "Implemented auth flow and unit tests"

   ⚠ Duplicates: 1 medium — same issue/date/duration recorded
   ⚠ Warnings: date is in the future

   ─────────────────────────────────────────────
   Approve? [y/N]

   - show duplicates and warnings prominently; a `high`-confidence duplicate
     must be called out and re-confirmed explicitly;
   - show the computed `timeSpentSeconds` so the user sees the exact payload.

4. Ask for explicit approval. Do NOT proceed on silence.
5. Only after the user approves, call `tempo_create_worklog` with the SAME
   values, the `approvalToken` from the preview, and `confirm: true`.
6. Report the result as:

   ✅ Created worklog #12345 for ABC-123 on 2026-10-30 (2h 30m)
   ✔ Verified against the Tempo API after the write.

   If the write returns `UNCERTAIN_OUTCOME`, output:
   ⚠ Outcome unknown — do NOT retry. Checking `tempo_get_worklogs` for the
   date... — then run that check and report what you find.
