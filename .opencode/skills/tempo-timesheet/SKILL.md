---
name: tempo-timesheet
description: Use when the user asks about their Tempo timesheet — summarizing logged work for a day or week, checking what was logged on a Jira issue, finding duplicates, or creating/updating Tempo worklogs. Enforces the preview-then-approve workflow and never writes without explicit approval.
---

# Tempo Timesheet Operations

You have access to a Tempo Timesheets MCP server with 9 tools backed by the
Tempo v4 REST API and (when configured) the Jira Cloud v3 API.

## Tools

| Tool | Purpose |
|---|---|
| `tempo_get_worklogs` | List recorded worklogs in a date range |
| `tempo_get_worklog` | Fetch one worklog by id |
| `tempo_get_week_summary` | Aggregate one week (Mon–Sun) by day and issue |
| `jira_search_issues` | Search Jira issues via JQL (helps resolve issue keys) |
| `tempo_preview_worklog` | Dry-run a create: validates, checks duplicates, returns an approval token |
| `tempo_validate_worklog` | Validate a proposal without issuing an approval token |
| `tempo_check_duplicate` | Check a proposal against existing worklogs for that issue/date |
| `tempo_create_worklog` | Create a worklog (requires approval token + `confirm: true`) |
| `tempo_update_worklog` | Update an existing worklog (requires approval token + `confirm: true`) |

## Hard rules

1. **Never call `tempo_create_worklog` or `tempo_update_worklog` without a
   fresh preview.** The approval token is bound to the exact payload — if the
   user changes anything (issue, date, duration, description), you MUST run
   `tempo_preview_worklog` again to get a new token. Reusing a token after any
   change fails by design.
2. **Pass `confirm: true` only after the user has approved the preview.** Show
   the preview (issue, date, duration, duplicates) and ask. Do not treat
   silence as approval.
3. **A validation success is not an approval.** Even if `tempo_validate_worklog`
   returns no errors, the write path still needs a preview + token + confirm.
4. **Never retry an uncertain write.** If a create/update returns
   `UNCERTAIN_OUTCOME`, the result is unknown. Check with `tempo_get_worklogs`
   for the affected date and report to the user before doing anything else.
5. **Never delete worklogs.** The server has no delete tool by design.

## Summaries use recorded data only

`tempo_get_week_summary` reports RECORDED worklogs only. Days with no records
may be days off, holidays, or unlogged work — the server cannot tell. When the
user asks "did I log everything this week?", present the per-day totals and
explicitly list the days without records; never invent gaps or assume missed
work.

## Typical flows

**Daily summary:** call `tempo_get_worklogs` for the date (or
`tempo_get_week_summary` for a week), group by issue, report totals plus days
without records.

**Log new work:**
1. `tempo_preview_worklog` with issueKey, date, durationMinutes, description.
2. Show the user: resolved issue, computed seconds, duplicates found, warnings.
3. If duplicates exist (especially `high` confidence), ask whether to proceed.
4. On explicit approval, call `tempo_create_worklog` with the SAME values plus
   the `approvalToken` and `confirm: true`.
5. Report the created worklog id and whether post-write verification succeeded.

**Update existing work:** call `tempo_preview_worklog` with `operation: "update"`,
`worklogId`, and `changes`. Show the before/after to the user and follow the
same approval ritual, then call `tempo_update_worklog` with the same worklogId,
changes, token, and `confirm: true`.
