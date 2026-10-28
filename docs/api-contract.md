# API Contract (verified)

Endpoints and payload shapes below were verified against the official API
documentation before implementation. Unverified or ambiguous points are listed
explicitly at the end and are called out in code comments.

## Tempo Timesheets REST API v4

- Base URL: `https://api.tempo.io/4` (configurable via `TEMPO_BASE_URL`).
- Auth: `Authorization: Bearer <TEMPO_API_TOKEN>`.
- JSON everywhere; pagination envelope:

```json
{
  "metadata": { "count": 0, "limit": 1000, "offset": 0, "next": "...", "previous": "..." },
  "results": [ ... ]
}
```

### GET /worklogs

Query parameters used by this server: `from`, `to` (YYYY-MM-DD, inclusive),
`issueId` (repeatable), `authorId`, `offset`, `limit`. The client pages with
`offset` until a page returns fewer results than the limit, with a hard cap on
pages per request to guard against loops.

### GET /worklogs/{id}

Returns a single worklog object (404 → `NOT_FOUND`).

### POST /worklogs

Verified request body:

```json
{
  "issueId": 10001,
  "timeSpentSeconds": 5400,
  "startDate": "2026-10-28",
  "description": "Implement feature",
  "startTime": "09:00:00",
  "authorAccountId": "optional-override",
  "attributes": []
}
```

Note: v4 identifies the issue by numeric **`issueId`**, not `issueKey`.

### PUT /worklogs/{id}

See "Unverified assumptions" below — the docs disagree on whether the PUT body
identifies the issue by `issueKey` or `issueId`. This server sends `issueId`
(matching the create contract).

## Jira Cloud REST API v3

- Base URL: `https://<site>.atlassian.net`.
- Auth: HTTP Basic with `JIRA_EMAIL` + `JIRA_API_TOKEN`
  (`Authorization: Basic base64(email:token)`).
- Jira is optional: it is considered configured only when **all three** of
  `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` are set.

### POST /rest/api/3/search/jql

The modern enhanced-search endpoint (the legacy `POST /rest/api/3/search` is
being removed). Request: `{ "jql": "...", "maxResults": n, "nextPageToken":
"...", "fields": [...] }`. Pagination uses `nextPageToken` / `isLast`, not
offset.

Used for `jira_search_issues` and for resolving issue keys.

### GET /rest/api/3/issue/{keyOrId}

Used to resolve an issue key → numeric id (Tempo v4 returns only `issue.id`,
never the key, so display keys require Jira).

## Unverified assumptions (documented, not invented)

1. **Tempo PUT issue identifier** — `issueKey` vs `issueId` discrepancy in the
   docs. This server sends `issueId`. If Tempo rejects updates, this is the
   first thing to flip.
2. **Tempo page size ceiling** — docs conflict between 1000 and 5000 for
   `limit`. The client uses `limit=1000`, which is safe under both.
3. **Tempo `GET /worklogs` user filter parameter name** (`accountId` vs
   `authorId`) — the client uses the parameter documented for v4; if filtering
   by user returns unfiltered results, check this parameter first.

These do not affect read paths used by the summary tools in the default
configuration, but are worth re-verifying against the live API during rollout.
