# Setup for OpenCode

## 1. Get the server

**Option A — run from npm (recommended):** nothing to build; use
`npx tempo-worklog-mcp` as the command in step 3.

**Option B — from source:**

```bash
git clone https://github.com/nbhson/tool-logwork-mcp
cd tool-logwork-mcp
npm install
npm run build
```

Requires Node.js >= 20.

## 2. Configure credentials

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable                | Required | Notes                                                      |
| ----------------------- | -------- | ---------------------------------------------------------- |
| `TEMPO_API_TOKEN`       | yes      | Tempo API token (Tempo settings → API keys)                |
| `JIRA_BASE_URL`         | no*      | e.g. `https://yourco.atlassian.net`                        |
| `JIRA_EMAIL`            | no*      | Atlassian account email                                    |
| `JIRA_API_TOKEN`        | no*      | Atlassian API token (id.atlassian.com)                     |
| `DEFAULT_TIMEZONE`      | no       | IANA name; defaults to system TZ (e.g. `Asia/Ho_Chi_Minh`) |
| `LOG_LEVEL`             | no       | `debug`, `info` (default), `warn`, `error`                 |
| `WORKLOG_WRITE_ENABLED` | no       | `false` (default) — writes disabled                        |

\* Jira is optional; if used, all three `JIRA_*` values must be set together.
Jira is needed for `jira_search_issues` and to display issue keys (Tempo v4
returns numeric ids only).

## 3. Register the MCP server in OpenCode

Add to `.opencode/opencode.json` (project) or the global OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tempo-timesheet": {
      "type": "local",
      "command": ["npx", "tempo-worklog-mcp"],
      "environment": {
        "TEMPO_API_TOKEN": "your-token-here",
        "WORKLOG_WRITE_ENABLED": "false"
      }
    }
  }
}
```

Notes:

- `["npx", "tempo-worklog-mcp"]` runs the published npm package. If you built
  from source, use `["node", "<absolute path>/dist/index.js"]` instead.
- Credentials can live in the `environment` block or in a `.env` next to the
  server; the server reads dotenv from its working directory. Prefer the
  OpenCode `environment` block so one config file holds everything — but then
  that file holds a secret too, so do not commit it.
- To allow writes, set `"WORKLOG_WRITE_ENABLED": "true"`. Keep it `false`
  until you have walked through the preview → approve → write flow once.

## 4. Skill and commands

This repository ships:

- `.opencode/skills/tempo-timesheet/SKILL.md` — picked up automatically when
  OpenCode runs in this project (or copy the folder into the target project).
- `.opencode/commands/tempo-today.md`, `tempo-week.md`, `tempo-log.md` —
  slash commands (`/tempo-today`, `/tempo-week`, `/tempo-log ABC-123 ...`).

To use them in another project, copy the `.opencode` folder there and point
the MCP config at this server.

## 5. Verify

```bash
# quick stdio smoke test (PowerShell)
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}',
'{"jsonrpc":"2.0","method":"notifications/initialized"}',
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/index.js
```

The last stdout line must list 9 tools. Inside OpenCode, ask "what Tempo tools
do you have?" — the model should list them.

## Troubleshooting

| Symptom                                | Cause / fix                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AUTH_ERROR` on every call             | Bad/expired `TEMPO_API_TOKEN`, or wrong `TEMPO_BASE_URL`                                          |
| `CONFIG_ERROR: Jira is not configured` | Only some of the three `JIRA_*` vars set — set all three or none                                  |
| `WRITE_DISABLED`                       | Expected: set `WORKLOG_WRITE_ENABLED=true` to enable writes                                       |
| `APPROVAL_REQUIRED` on a write         | Token expired (>15 min) or payload changed after preview — re-preview                             |
| `UNCERTAIN_OUTCOME`                    | The write may or may not have landed — check `tempo_get_worklogs` for the date; never blind-retry |
| `PERMISSION_ERROR` on search           | Jira token lacks access to the projects in the JQL                                                |
| Issue keys shown as numeric ids        | Jira not configured — set the three `JIRA_*` vars to enable key resolution                        |
| Timezone looks wrong (off-by-one day)  | Set `DEFAULT_TIMEZONE` to an IANA name                                                            |
