---
description: Summarize this week's Tempo timesheet
---

Summarize my Tempo timesheet for a week. `$ARGUMENTS` may be empty, a date
inside the target week (YYYY-MM-DD), or "last".

1. Resolve the week (Monday–Sunday): from `$ARGUMENTS` if given, otherwise the
   current week.
2. Call `tempo_get_week_summary` for that week.
3. Report:
   - total logged time for the week;
   - per-day breakdown (date → total, issues worked);
   - the list of weekdays with NO recorded worklogs, clearly labeled as "no
     recorded worklogs" — never as "missing work";
   - per-issue totals across the week.
4. If the user seems to want a completeness check, explicitly call out the
   days without records and ask whether those were days off or unlogged work.
