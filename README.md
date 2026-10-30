# Tempo Timesheet MCP Server

[![npm](https://img.shields.io/npm/v/s-tempo-worklog-mcp)](https://www.npmjs.com/package/s-tempo-worklog-mcp)
[![node](https://img.shields.io/badge/node-%E2%89%A520-blue)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/s-tempo-worklog-mcp)](LICENSE)

A local MCP server (stdio) that gives coding agents such as OpenCode or Claude
Code safe, read-first access to **Tempo Timesheets** (REST API v4) and
**Jira Cloud** (REST API v3): summarize logged work, detect duplicates, and —
only through an explicit preview → approval → write pipeline — create or
update worklogs.

> Read-only by default. Writes are triple-gated: `WORKLOG_WRITE_ENABLED=true`
> **and** a single-use payload-bound approval token **and** `confirm: true`.
> There is no delete tool.

## How it works

```
┌─────────────────────┐   MCP over stdio    ┌──────────────────────┐   REST API v4   ┌────────────────────┐
│   Coding agent      │◄───────────────────►│  s-tempo-worklog-mcp │ ───────────────►│  Tempo Timesheets  │
│  (OpenCode, Claude  │    9 tools (JSON)   │  (this MCP server)   │                 │      (v4)          │
│  Code, any client)  │                     │  validate · approve  │ ───────────────►├────────────────────┤
└─────────────────────┘                     │  write               │   REST API v3   │      Jira Cloud    │
        ▲                                   └──────────┬───────────┘                 │      (v3)          │
        │  /tempo-today  /tempo-week  /tempo-log       │                             └────────────────────┘
        │  (OpenCode slash commands)                   │  all credentials stay local
        └──────────────────────────────────────────────┘  (env vars / .env)
```

- **You** (or your agent) issue commands in the CLI — natural language or the
  bundled slash commands.
- The **agent** calls this MCP server over stdio; the server owns validation,
  duplicate detection, and the approval pipeline.
- The server talks **only** to the Tempo v4 and (optionally) Jira v3 REST APIs.
  Credentials never leave your machine; the server is stdio-only.

### The write pipeline (triple-gated)

```
 preview ──► user approval ──► write (confirm + single-use token) ──► verify
```

1. `tempo_preview_worklog` validates the proposal, runs duplicate detection,
   and issues an approval token bound to the SHA-256 of the payload.
2. You review and approve. Any change to the payload invalidates the token.
3. The write tool requires `WORKLOG_WRITE_ENABLED=true`, the token, and an
   explicit `confirm: true`. Tokens are **single-use** — a replayed approval
   cannot create a second identical worklog. Timed-out writes return
   `UNCERTAIN_OUTCOME` and are never retried by the server.

## Tools (9)

| Tool                     | Kind          | Description                                                                         |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------- |
| `tempo_get_worklogs`     | read          | Worklogs in a date range; scoped to your own account by default                     |
| `tempo_get_worklog`      | read          | One worklog by id                                                                   |
| `tempo_get_week_summary` | read          | Week (Mon–Sun) aggregated by day and issue                                          |
| `jira_search_issues`     | read          | Jira search via JQL (enhanced search API)                                           |
| `tempo_preview_worklog`  | preview       | Validate + duplicate-check a create/update; returns an approval token. Never writes |
| `tempo_validate_worklog` | preview       | Validate a proposal without issuing a token                                         |
| `tempo_check_duplicate`  | preview       | Confidence-scored duplicate check for a candidate entry                             |
| `tempo_create_worklog`   | write (gated) | Create a worklog; needs token + `confirm`                                           |
| `tempo_update_worklog`   | write (gated) | Update a worklog; needs token + `confirm`                                           |

The write flow is: **preview → show the user → explicit approval → write with
the same exact payload**. The approval token is bound to the SHA-256 of the
payload (identified by numeric `issueId`), expires in 15 minutes, is consumed
by a successful write, and is invalidated by any change. Writes that time out
return `UNCERTAIN_OUTCOME` and are never retried by the server.

## Install

**Run directly with npx (no installation):**

```bash
npx -y s-tempo-worklog-mcp
```

**Or install globally:**

```bash
npm install -g s-tempo-worklog-mcp
tempo-worklog-mcp
```

The server reads configuration from environment variables. Create a `.env`
file next to where you run it, or set them in your MCP client config.

| Variable                | Default                | Description                                                              |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------ |
| `TEMPO_API_TOKEN`       | — (required)           | Tempo API token                                                          |
| `TEMPO_ACCOUNT_ID`      | auto-detected          | Your Tempo accountId; auto-detected from an existing worklog when absent |
| `TEMPO_BASE_URL`        | `https://api.tempo.io` | Tempo v4 base URL                                                        |
| `JIRA_BASE_URL`         | — (optional)           | `https://<site>.atlassian.net`                                           |
| `JIRA_EMAIL`            | — (optional)           | Atlassian account email                                                  |
| `JIRA_API_TOKEN`        | — (optional)           | Atlassian API token                                                      |
| `DEFAULT_TIMEZONE`      | system TZ              | IANA name, e.g. `Asia/Ho_Chi_Minh`                                       |
| `LOG_LEVEL`             | `info`                 | `debug` \| `info` \| `warn` \| `error`                                   |
| `WORKLOG_WRITE_ENABLED` | `false`                | Master switch for write tools                                            |

Jira is optional but recommended: Tempo v4 returns only numeric issue ids, so
without Jira the tools cannot display issue keys. All three `JIRA_*` variables
must be set together. See `.env.example` for a ready-made template.

## Quick start (from source)

```bash
git clone https://github.com/nbhson/tool-logwork-mcp
cd tool-logwork-mcp
npm install
npm run build
cp .env.example .env   # then fill in TEMPO_API_TOKEN (+ Jira if desired)
node dist/index.js
```

Full setup for OpenCode (MCP registration, skill, commands, troubleshooting):
[docs/setup-opencode.md](docs/setup-opencode.md).

## Registering with MCP clients

The server speaks MCP over stdio. Generic pattern — run
`npx -y s-tempo-worklog-mcp` as the command and pass environment variables:

**OpenCode** (`~/.config/opencode/opencode.json` or project `opencode.json`):

```json
{
  "mcp": {
    "tempo-worklog": {
      "type": "local",
      "command": ["npx", "-y", "s-tempo-worklog-mcp"],
      "environment": {
        "TEMPO_API_TOKEN": "your-tempo-token",
        "JIRA_BASE_URL": "https://your-site.atlassian.net",
        "JIRA_EMAIL": "you@example.com",
        "JIRA_API_TOKEN": "your-jira-token"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add tempo-worklog \
  -e TEMPO_API_TOKEN=your-tempo-token \
  -- npx -y s-tempo-worklog-mcp
```

## OpenCode skill & slash commands

This repository ships an agent skill and three slash commands (`.opencode/`).
After installing from npm, copy them into your project:

```bash
# OpenCode loads skills/commands from your project's .opencode/ directory
mkdir -p .opencode/skills
cp -r node_modules/s-tempo-worklog-mcp/.opencode/skills/tempo-timesheet .opencode/skills/
cp -r node_modules/s-tempo-worklog-mcp/.opencode/commands ./
```

This gives you:

- `.opencode/skills/tempo-timesheet/SKILL.md` — tool catalog + hard rules
  (preview-before-write, never retry uncertain writes, recorded-data-only
  summaries).
- `.opencode/commands/tempo-today.md` — `/tempo-today` daily summary with an
  aligned terminal report.
- `.opencode/commands/tempo-week.md` — `/tempo-week` weekly timesheet with
  per-day and per-issue breakdowns.
- `.opencode/commands/tempo-log.md` — `/tempo-log ABC-123 2h30m ...` with the
  preview card and approval ritual baked in.

Details: [docs/setup-opencode.md](docs/setup-opencode.md).

## Safety model

- **Read-first.** Every read tool is safe to call; nothing writes unless you
  go through the pipeline.
- **Triple-gated writes.** `WORKLOG_WRITE_ENABLED=true` + preview approval
  token + `confirm: true`. The token binds to the SHA-256 of the exact payload
  (identified by numeric `issueId`, so a Jira hiccup between preview and write
  cannot invalidate a valid approval), expires in 15 minutes, and is consumed
  on success — no replay, no duplicates from retries.
- **Uncertain outcomes are reported, never retried.** A timed-out write
  returns `UNCERTAIN_OUTCOME`; the server never auto-retries a write.
- **Honest scoping.** Read tools scope results to your own account by default
  and say so; totals never silently mix in other users' worklogs.
- **No delete.** Tempo delete is intentionally not exposed.
- **Recorded data only.** Summaries count recorded worklogs only — no invented
  hours, no assumed work.

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

Test suite: **77 tests, all passing** (unit: config, date, duration, approval,
report, duplicate; integration: Tempo client, Jira client, worklog service —
HTTP fully mocked, no credentials or network needed). `npm publish` runs the
full gate automatically via `prepublishOnly`.

## Documentation

- [docs/architecture.md](docs/architecture.md) — layers, request flows, error model
- [docs/api-contract.md](docs/api-contract.md) — verified endpoints + unverified assumptions
- [docs/security.md](docs/security.md) — credential handling, write-safety model
- [docs/workflows.md](docs/workflows.md) — agent workflows (daily/weekly/logging/update)
- [docs/setup-opencode.md](docs/setup-opencode.md) — OpenCode registration + troubleshooting

The Vietnamese design documents in
[docs/design/](docs/design/) (`architecture.md`, `security.md`, `skills.md`,
`structure.md`, `tools.md`, `workflow.md`) are the original design briefs this
implementation follows; the `docs/` files above describe the implementation
as built.

## Known limitations

- **No delete.** Tempo delete is intentionally not exposed in this MVP.
- **Update identifier risk.** Tempo docs disagree on `issueKey` vs `issueId`
  for `PUT /worklogs/{id}`; this server sends `issueId`
  ([docs/api-contract.md](docs/api-contract.md)).
- **Single user focus.** Read tools default to your own account (pass
  `authorAccountId` to inspect another user); admin-style logging for others
  is out of scope.
- **Approval state is in memory.** Restarting the server invalidates pending
  approval tokens (by design — re-preview is cheap and safe).
- **No Overtime/Capacity/accounts endpoints.** Worklogs and issue search only.
- **Caller identity needs one worklog.** Auto-detecting your account reads the
  author of your most recent worklog; on a brand-new account with zero
  worklogs, set `TEMPO_ACCOUNT_ID` explicitly.

## What's new in 0.4.0

- **Fixed** auto-detection of the Tempo account id (it previously read the
  wrong endpoint and could send a wrong `authorAccountId` on create).
- **Read tools now scope to your own account by default**, so totals never
  silently include other users' worklogs; pass `authorAccountId` to override.
- **Approval tokens are single-use** — no replay/duplicate window after a
  successful write (still reusable when a write fails cleanly).
- Approvals are bound by numeric `issueId`, so a Jira hiccup between preview
  and write no longer invalidates a valid approval.
- Updating a worklog no longer fails when its existing duration is not a
  whole number of minutes (e.g. timer-derived `89m30s`).
- Pagination: results are never returned beyond `maxResults`, and exhausted
  pagination now fails loudly instead of silently truncating.
- Cleaner validation errors for malformed create previews (no crash on
  missing description); `tempo_update_worklog` now returns the structured
  `WRITE_DISABLED` error code like `tempo_create_worklog`.
