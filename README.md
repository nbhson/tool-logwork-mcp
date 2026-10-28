# Tempo Timesheet MCP Server

A local MCP server (stdio) that gives coding agents such as OpenCode safe,
read-first access to **Tempo Timesheets** (REST API v4) and **Jira Cloud**
(REST API v3): summarize logged work, detect duplicates, and — only through an
explicit preview → approval → write pipeline — create or update worklogs.

> Read-only by default. Writes are triple-gated: `WORKLOG_WRITE_ENABLED=true`
> **and** a payload-bound approval token **and** `confirm: true`. There is no
> delete tool.

## Tools (9)

| Tool | Kind | Description |
|---|---|---|
| `tempo_get_worklogs` | read | Worklogs in a date range, optionally by user |
| `tempo_get_worklog` | read | One worklog by id |
| `tempo_get_week_summary` | read | Week (Mon–Sun) aggregated by day and issue |
| `jira_search_issues` | read | Jira search via JQL (enhanced search API) |
| `tempo_preview_worklog` | preview | Validate + duplicate-check a create/update; returns an approval token. Never writes |
| `tempo_validate_worklog` | preview | Validate a proposal without issuing a token |
| `tempo_check_duplicate` | preview | Confidence-scored duplicate check for a candidate entry |
| `tempo_create_worklog` | write (gated) | Create a worklog; needs token + `confirm` |
| `tempo_update_worklog` | write (gated) | Update a worklog; needs token + `confirm` |

The write flow is: **preview → show the user → explicit approval → write with
the same exact payload**. The approval token is bound to the SHA-256 of the
payload, expires in 15 minutes, and is invalidated by any change. Writes that
time out return `UNCERTAIN_OUTCOME` and are never retried by the server.

## Quick start

```bash
npm install
npm run build
cp .env.example .env   # then fill in TEMPO_API_TOKEN (+ Jira if desired)
node dist/index.js
```

Full setup for OpenCode (MCP registration, skill, commands, troubleshooting):
[docs/setup-opencode.md](docs/setup-opencode.md).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TEMPO_API_TOKEN` | — (required) | Tempo API token |
| `TEMPO_BASE_URL` | `https://api.tempo.io` | Tempo v4 base URL |
| `JIRA_BASE_URL` | — (optional) | `https://<site>.atlassian.net` |
| `JIRA_EMAIL` | — (optional) | Atlassian account email |
| `JIRA_API_TOKEN` | — (optional) | Atlassian API token |
| `DEFAULT_TIMEZONE` | system TZ | IANA name, e.g. `Asia/Ho_Chi_Minh` |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `WORKLOG_WRITE_ENABLED` | `false` | Master switch for write tools |

Jira is optional but recommended: Tempo v4 returns only numeric issue ids, so
without Jira the tools cannot display issue keys. All three `JIRA_*` variables
must be set together.

## OpenCode integration

Ships with an agent skill and three slash commands:

- `.opencode/skills/tempo-timesheet/SKILL.md` — tool catalog + hard rules
  (preview-before-write, never retry uncertain writes, recorded-data-only
  summaries).
- `.opencode/commands/tempo-today.md` — `/tempo-today` daily summary.
- `.opencode/commands/tempo-week.md` — `/tempo-week` weekly timesheet.
- `.opencode/commands/tempo-log.md` — `/tempo-log ABC-123 2h30m ...` with the
  approval ritual baked in.

Register the server in OpenCode config (`mcp.tempo-timesheet.type = "local"`):
see [docs/setup-opencode.md](docs/setup-opencode.md).

## Development

```bash
npm run typecheck        # strict typecheck of src
npm run typecheck:test   # typecheck of src + tests
npm run lint             # eslint (src + tests)
npm run format           # prettier
npm test                 # vitest (unit + integration, mocked HTTP)
npm run build            # tsc -> dist/
npm start                # run the stdio server
```

Test suite: **56 tests, all passing** (unit: config, date, duration, approval,
report, duplicate; integration: Tempo client, Jira client, worklog service —
HTTP fully mocked, no credentials or network needed).

## Documentation

- [docs/architecture.md](docs/architecture.md) — layers, request flows, error model
- [docs/api-contract.md](docs/api-contract.md) — verified endpoints + unverified assumptions
- [docs/security.md](docs/security.md) — credential handling, write-safety model
- [docs/workflows.md](docs/workflows.md) — agent workflows (daily/weekly/logging/update)
- [docs/setup-opencode.md](docs/setup-opencode.md) — OpenCode registration + troubleshooting

The Vietnamese design documents at the repo root (`architecture.md`,
`security.md`, `skills.md`, `structure.md`, `tools.md`, `workflow.md`) are the
original design briefs this implementation follows; the `docs/` files above
describe the implementation as built.

## Known limitations

- **No delete.** Tempo delete is intentionally not exposed in this MVP.
- **Update identifier risk.** Tempo docs disagree on `issueKey` vs `issueId`
  for `PUT /worklogs/{id}`; this server sends `issueId`
  ([docs/api-contract.md](docs/api-contract.md)).
- **Single user focus.** Multi-user author attribution is supported only via
  the Tempo token's own account; admin-style logging for others is out of
  scope.
- **Approval state is in memory.** Restarting the server invalidates pending
  approval tokens (by design — re-preview is cheap and safe).
- **No Overtime/Capacity/accounts endpoints.** Worklogs and issue search only.
