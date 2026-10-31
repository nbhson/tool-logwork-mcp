---
description: Log Tempo work for one or MANY issues with AI-rewritten professional descriptions (preview first, write only after approval)
---

Log Tempo work for Jira issue(s), rewriting long/rough descriptions into
professional ones. Accepts a single entry or a BATCH of entries, given inline
or as pasted/attached content (txt, md, csv, table, bullet list, freeform
prompt text).

## Input — how to parse `$ARGUMENTS`

`$ARGUMENTS` may be, in any of these forms:

1. **Single inline entry**: `issueKey date duration description`
   (e.g. `ABC-123 2026-10-28 2h30m Fixed the login bug`).
2. **Multiple inline entries**: several entries in one message, separated by
   newlines, blank lines, bullets, or numbering.
3. **A file path or pasted content** (`.txt`, `.md`, `.csv`, or raw prompt):
   read/inspect it and extract every loggable entry. Supported shapes:
   - CSV rows / markdown tables with columns like issue, date, duration/hours,
     description (column order and header naming may vary — infer them);
   - bullet or numbered lists mentioning an issue key + time + what was done;
   - freeform prose mentioning several tickets ("spend 2h on ABC-123 fixing
     ... then 1h on ABC-456 ...").
4. **Mixed**: a file plus extra inline notes that override or add entries.

Parsing rules:

- Each entry resolves to: issueKey, date, duration, description.
- A date stated once at the top (or in the prompt) applies to entries without
  their own date; default to today.
- Accept durations as `1h30m`, `90m`, `1.5h`, `2`, `2.0` (decimal hours) —
  infer from context; a bare number next to "hours"/"h" is decimal hours.
- Never guess an issue key. Entries without a resolvable issue key are listed
  as SKIPPED with the reason, not silently dropped.
- If nothing at all is parseable, ask for the missing parts instead of
  inventing entries.

## Per-entry pipeline

For EACH parsed entry, in order:

1. **Rewrite the description** before anything else. Rules for the rewrite:
   - **Meaning is sacred**: keep every fact the user stated (what was done,
     on which component/feature, outcomes, follow-ups). Never invent details,
     ticket numbers, metrics, or work that was not mentioned.
   - Make it professional and concise: clear sentence(s), no filler words, no
     greetings, no first-person chatter.
   - Prefer work-log phrasing: start with the action verb in past tense
     ("Implemented", "Fixed", "Investigated", "Refactored").
   - Keep domain terms, issue-specific names, and technical keywords exactly
     as given (they matter for searchability).
   - Preserve the original language of the description (Vietnamese stays
     Vietnamese, English stays English); do not translate.
   - If a description contains multiple distinct pieces of work, keep them as
     short separated clauses or semicolons — do not drop any.
   - Target length: 1–3 sentences, roughly ≤ 200 characters when possible.
     Only go longer if dropping text would lose meaning.

2. Call `tempo_preview_worklog` for that entry with the REWRITTEN description:
   `{ operation: "create", issueKey, date, durationMinutes, description }`.
   Each entry gets its own `approvalToken` — tokens are never shared.

3. Present ONE combined preview card listing every entry, EXACTLY:

   ┌─────────────────────────────────────────────
   │ 👁 PREVIEW — create 3 worklogs (rewritten)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   1. Issue ABC-123 — Fix login bug (In Progress)
      Date 2026-10-30 · Duration 2h 30m (9000s)
      Description (original)
      "fixed the login bug, it was a null check issue and added some tests too"
      Description (rewritten)
      "Fixed login bug caused by missing null check; added unit tests"

   2. Issue ABC-456 — Review PR
      Date 2026-10-30 · Duration 1h 00m (3600s)
      ...

   ⚠ Duplicates: entry 2 duplicates worklog #9988 (same issue/date/duration)
   ⚠ Skipped: 1 line had no issue key ("half day meetings stuff")
   ⚠ Warnings: date is in the future

   ─────────────────────────────────────────────
   Approve all? [y/N] (or approve selectively, e.g. "1 only")

   - ALWAYS show both the original and the rewritten description for EVERY
     entry so the user can verify meaning was preserved;
   - if any rewrite changed or dropped something the user might care about,
     point it out explicitly below the card;
   - ALSO flag cross-entry duplicates WITHIN the batch: two entries logging
     the same issue + date;
   - show duplicates and warnings prominently; a `high`-confidence duplicate
     must be called out and re-confirmed explicitly;
   - show the computed `timeSpentSeconds` for each entry.

4. Ask for explicit approval. Do NOT proceed on silence. Approval may be for
   all entries or a selected subset ("only 1 and 3" → log only those). If the
   user rejects or edits any rewrite, apply their wording and re-run the
   preview for the affected entries only (a changed payload always needs a
   new preview).

5. Only for approved entries, call `tempo_create_worklog` sequentially — each
   with its OWN rewritten values, its OWN `approvalToken`, and
   `confirm: true`. Never batch two creates into one call.

6. Report per entry:

   ✅ Created worklog #12345 for ABC-123 on 2026-10-30 (2h 30m)
   ✅ Created worklog #12346 for ABC-456 on 2026-10-30 (1h 00m)
   ✔ Verified against the Tempo API after the writes.

   If any write returns `UNCERTAIN_OUTCOME` for that entry:
   ⚠ Outcome unknown for ABC-456 — do NOT retry it. Checking
   `tempo_get_worklogs` for the date... — then run that check and report.
   Other entries continue/complete independently; an uncertain entry never
   blocks the already-approved entries from being reported truthfully.
