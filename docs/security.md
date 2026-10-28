# Security

## Credentials

- Credentials are read **only** from environment variables (optionally via a
  gitignored `.env` file): `TEMPO_API_TOKEN`, `JIRA_BASE_URL`, `JIRA_EMAIL`,
  `JIRA_API_TOKEN`.
- Credentials never appear in logs, tool results, error messages, tests, or
  this documentation. Error messages contain URL paths and status codes only.
- `.env.example` contains placeholders only. `.gitignore` excludes `.env`.
- The approval token is a locally generated random string bound to a SHA-256
  hash of the exact write payload. It grants no access to the APIs by itself.

## Write safety model

Writes are opt-in at three independent layers:

1. **Environment gate** — `WORKLOG_WRITE_ENABLED` defaults to `false`. With
   the default, `tempo_create_worklog` / `tempo_update_worklog` return a
   structured `WRITE_DISABLED` error before touching the API.
2. **Approval token** — issued only by `tempo_preview_worklog`, bound to the
   SHA-256 of the exact payload, TTL 15 minutes. Any payload change invalidates
   the token. The server never auto-reissues or auto-consumes tokens.
3. **Explicit confirm flag** — write tools require `confirm: true` in the tool
   arguments, so the calling agent must pass an affirmative signal, not merely
   omit a guard.

Additional invariants:

- **No deletion.** The MVP exposes no delete tool and the Tempo delete
  endpoint is never called.
- **No retry of uncertain writes.** A POST/PUT that times out or fails at the
  transport level yields `UNCERTAIN_OUTCOME`; the server never re-sends it.
  Reads (GET) may retry idempotently on 429/5xx honoring `Retry-After`.
- **Post-write verification.** After a successful write, the server re-reads
  the worklog and reports `verification: verified | unverified`.

## Data exposure

- The server processes only what the user's tokens can already see. It adds no
  privilege escalation; MCP clients run locally under the user's account.
- Tool results include issue ids/keys, dates, durations, and descriptions —
  the same data visible in Tempo/Jira. Nothing is cached to disk; the only
  in-memory state is the approval table (token → payload hash + expiry).
- Logs are written to stderr at `LOG_LEVEL` (default `info`) and contain no
  tokens or payload bodies.

## Threat notes

- **Prompt-injection through issue summaries/descriptions:** worklog
  descriptions and Jira summaries are user-controlled text that an agent will
  read. The design limits the blast radius: writes require a fresh preview +
  human approval regardless of what the agent was told, so injected
  instructions cannot by themselves produce a write.
- **Token theft of `TEMPO_API_TOKEN`:** grants whatever the Tempo token can
  do. Recommend a scoped API token and rotating it; the server never writes it
  anywhere.
