# Architecture

Tempo Timesheet MCP Server — a local stdio MCP server that gives coding agents
safe, read-first access to Tempo Timesheets and (optionally) Jira Cloud.

## High-level view

```mermaid
flowchart LR
    OC[OpenCode / MCP client] <-- JSON-RPC over stdio --> SRV[MCP Server\nNode.js process]
    SRV --> TC[TempoClient]
    SRV --> JC[JiraClient]
    SRV --> WS[WorklogService\norchestration + gates]
    SRV --> AS[ApprovalService\nin-memory]
    TC --> T4[Tempo REST API v4\napi.tempo.io/4]
    JC --> J3[Jira REST API v3\n<site>.atlassian.net]
```

The server runs on the user's machine. Credentials live in the environment
(`.env`), never in logs or tool output. The only transport is stdio; there is
no network listener.

## Layering

```mermaid
flowchart TD
    subgraph Tools
        REG[register.ts\n9 tools]
    end
    subgraph Services
        WS[WorklogService]
        AS[ApprovalService]
        DS[DuplicateService]
        VS[ValidationService]
        RS[ReportService]
    end
    subgraph Clients
        BC[BaseClient\nHTTP, retries, errors]
        TC[TempoClient]
        JC[JiraClient]
    end
    subgraph Infra
        CFG[config/env.ts]
        SCH[schemas/worklog.schema.ts\nZod]
        U[utils: date, duration, logger, errors]
    end
    REG --> WS
    REG --> SCH
    WS --> TC
    WS --> JC
    WS --> AS
    WS --> DS
    WS --> VS
    RS <--> WS
    TC --> BC
    JC --> BC
    CFG --> Tools
```

Rules between layers:

- **Tools never call clients directly.** They call services, which own the
  workflow invariants (preview → approval → write).
- **Clients are dumb HTTP wrappers.** They know one API each, map transport
  errors to typed errors, and never enforce business policy.
- **Schemas (Zod) are the single source of truth** for tool input validation.

## Request flow: write path (the important one)

```mermaid
sequenceDiagram
    participant U as User
    participant A as Agent
    participant S as MCP Server
    participant T as Tempo API

    A->>S: tempo_preview_worklog (create)
    S->>S: resolve issue (Jira) → validate → duplicate check
    S-->>A: preview + approvalToken (SHA-256-bound, 15 min TTL)
    A-->>U: show preview, ask for approval
    U-->>A: approves
    A->>S: tempo_create_worklog (same payload + token + confirm:true)
    S->>S: WORKLOG_WRITE_ENABLED? token valid? hash matches?
    S->>T: POST /worklogs
    S->>T: GET /worklogs/:id (post-write verification)
    S-->>A: outcome {verification: verified|unverified}
```

Safety invariants implemented in `WorklogService`:

1. A preview never writes.
2. A successful validation is not an approval — writes additionally require
   `WORKLOG_WRITE_ENABLED=true`, `confirm: true`, and a valid approval token.
3. The approval token is bound to the SHA-256 hash of the exact payload. Any
   change (issue, date, duration, description, startTime) invalidates it.
4. Uncertain outcomes (timeout / network failure on POST/PUT) surface as
   `UNCERTAIN_OUTCOME` and are never retried by the server.
5. No delete operation exists.

## Error model

| Code                        | Meaning                                   | Retry?                   |
| --------------------------- | ----------------------------------------- | ------------------------ |
| `VALIDATION_ERROR`          | Bad input / 400 from API                  | No                       |
| `AUTH_ERROR`                | 401/403 — token or permission problem     | No                       |
| `NOT_FOUND`                 | 404                                       | No                       |
| `RATE_LIMITED`              | 429 (retried internally with Retry-After) | Auto (GET only)          |
| `NETWORK_ERROR` / `TIMEOUT` | Transport failure on reads                | Auto (GET only)          |
| `UNCERTAIN_OUTCOME`         | Write may or may not have landed          | **Never — verify first** |
| `WRITE_DISABLED`            | `WORKLOG_WRITE_ENABLED=false`             | N/A                      |
| `APPROVAL_REQUIRED`         | Missing/expired/mismatched approval token | Re-preview               |
| `CONFIG_ERROR`              | Missing configuration                     | N/A                      |

## Module map

```
src/
├── index.ts              # entry: dotenv, config, stdio server
├── config/env.ts         # AppConfig (Tempo, Jira, timezone, writeEnabled)
├── clients/
│   ├── base-client.ts    # shared fetch: timeout, retry (GET only), error mapping
│   ├── tempo-client.ts   # Tempo v4 (Bearer auth, envelope pagination)
│   └── jira-client.ts    # Jira v3 (Basic auth, /search/jql, nextPageToken)
├── services/
│   ├── worklog-service.ts     # orchestration + write gates
│   ├── approval-service.ts    # token issuance + payload-hash binding
│   ├── duplicate-service.ts   # confidence-scored duplicate detection
│   ├── validation-service.ts  # calendar/date/duration validation
│   └── report-service.ts      # day/issue aggregation
├── tools/                # 9 tool registrations, thin
├── schemas/              # Zod tool input schemas
└── utils/                # date, duration, logger, errors
```
