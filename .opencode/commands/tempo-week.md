---
description: Summarize this week's Tempo timesheet
---

Summarize my Tempo timesheet for a week. `$ARGUMENTS` may be empty, a date
inside the target week (YYYY-MM-DD), or "last".

1. Resolve the week (Monday–Sunday): from `$ARGUMENTS` if given, otherwise the
   current week.
2. Call `tempo_get_week_summary` for that week.
3. Output using this template (plain text, aligned columns):

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   📅 TIMESHEET — Mon 2026-10-26 → Sun 2026-11-01
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Mon 2026-10-26 6h 30m
   • ABC-123 4h 00m Fix login bug
   • ABC-456 2h 30m Code review

   Tue 2026-10-27 8h 00m
   • ABC-123 8h 00m Auth implementation

   Wed 2026-10-28 — (no recorded worklogs)

   ─────────────────────────────────────────────
   Week total: 38h 00m (5 days logged, 0 without records)

   Per-issue:
   • ABC-123 20h 00m
   • ABC-456 11h 30m

4. Rules:
   - list weekdays with NO recorded worklogs in a separate line labeled
     "no recorded worklogs" — never as "missing work";
   - show `authorScope` from the tool response when it is `null` (unfiltered
     results) — the totals may include other users' worklogs;
   - never invent gaps: "no record" is all the server can say.
5. If the user seems to want a completeness check, explicitly call out the
   days without records and ask whether those were days off or unlogged work.
