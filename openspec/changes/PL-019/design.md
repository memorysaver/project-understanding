## Context

The crawler (PL-003) exposes `fetchById({ id, db, fetcher? })`: it calls the arXiv
API for one id (`export.arxiv.org/api/query?id_list=<id>`, an Atom feed), parses the
single `<entry>` into `ArxivMetadata`, and inserts a Paper with `ON CONFLICT DO
NOTHING` on `arxiv_id` (the table PRIMARY KEY — the dedup key). `arxiv.ts` already
owns the API client, the `USER_AGENT` arXiv etiquette requires, and
`ARXIV_MIN_INTERVAL_MS` (~3s). The pipeline's `discover` fan-out (PL-018,
`handleDiscover`) is the only fan-out point; today it enumerates a fixed
`DISCOVERY_SEED` of hardcoded ids and calls `fetchById` per id, then enqueues one
`digest` per *new* paper. PL-019 gives the crawler the real batch query the seed
stands in for. See the `crawler → db` interface in `product-context.yaml`
("insert Paper ON CONFLICT DO NOTHING") and the arXiv third-party entry
("honor ~1 req/3s rate limit").

## Goals / Non-Goals

**Goals:**
- A `discover` function that queries arXiv for a batch of recent papers, dedups by
  `arxiv_id`, and persists only papers not already stored.
- Re-running `discover` produces no duplicate Papers (dedup across runs).
- Return the newly-persisted papers so the orchestrator can fan out over them.

**Non-Goals:**
- No change to `fetchById` or its exports (additive only).
- No D1 schema change; no new dedup mechanism (reuse `arxiv_id` PRIMARY KEY +
  `ON CONFLICT DO NOTHING`).
- No orchestrator rewiring in this change (replacing `DISCOVERY_SEED` with a
  `discover` call is the orchestrator's follow-up); no Cron/cadence (Layer 2).
- No PDF/full-text fetch (that is the digestor stage).

## Decisions

- **Signature mirrors `fetchById` and is fully injectable.**
  `discover({ db, fetcher?, maxResults?, query? }): Promise<Paper[]>` — `db` is the
  injected `CrawlerDb`, `fetcher` defaults to the global `fetch` (tests inject a
  fixture so no real network is hit), `maxResults` bounds the batch (default a small
  fixed page), `query` selects the arXiv category/search (default the MVP feed). The
  return is the list of papers **newly persisted on this run** (not the full batch),
  so the orchestrator fans out exactly over new work.
- **Reuse the existing arXiv idiom for the batch query.** Query the arXiv list
  endpoint (`search_query=...&sortBy=submittedDate&sortOrder=descending&max_results=N`)
  instead of `id_list=<one id>`. The Atom response carries multiple `<entry>`
  elements; parse each into `ArxivMetadata` with the existing per-entry parser logic
  (title/summary/authors + the three derived URLs from the id). Add a multi-entry
  parser alongside `parseArxivAtom` rather than reimplementing entry parsing.
- **Dedup by `arxiv_id`, persist-only-new.** Insert every batch row with
  `INSERT ... ON CONFLICT DO NOTHING` on `arxiv_id` (the same mechanism `fetchById`
  uses), then return only the ids that did not already exist before this run — so a
  paper already stored (from a prior run or a prior `fetchById`) is neither
  re-inserted nor re-returned. "New" = not present in `papers` before this run.
- **Honor the rate limit + custom User-Agent.** Every request carries `USER_AGENT`;
  the batch query is a single API request per page (one list call returns N entries),
  so a normal discovery is one request. If paging issues multiple requests, space
  them by `ARXIV_MIN_INTERVAL_MS`. Do not exceed arXiv's ~1 req/3s etiquette.

## Boundary with the orchestrator fan-out (PL-018)

`discover` produces what `handleDiscover` consumes: the set of new Papers. The
orchestrator's resume-from-stage guard (a re-delivered `discover` must not re-fan-out
a paper already past `discovered`) stays in the orchestrator — `discover` only
guarantees row-level dedup (no duplicate Papers) and returns the run's new papers.
`handleDiscover` keeps owning the per-message idempotency (the `isAtOrPast(..., "digested")`
check before enqueuing `digest`). This change does not modify `handleDiscover`;
it provides the batch capability that replaces the `DISCOVERY_SEED` stand-in.

## Dependency APIs (consumed)

- **PL-003 crawler (merged):** `arxiv.ts` (`USER_AGENT`, `ARXIV_MIN_INTERVAL_MS`,
  `ARXIV_API_BASE`, entry-parse logic), the `papers` table dedup insert idiom, the
  `CrawlerDb` / `FetchLike` injection types.
- **PL-001 persistence (merged):** the `papers` table with `arxiv_id` PRIMARY KEY;
  tests use the in-memory `bun:sqlite` + the PL-001 migration harness (as
  `crawler.test.ts` already does).

## Risks / Trade-offs

- The arXiv list feed differs in shape from the single-id feed (entries are the
  recent submissions, not a known id); the multi-entry parser must tolerate entries
  missing optional fields and skip rather than throw on a malformed entry so one bad
  entry does not fail the whole batch. Pinned by a parser unit test.
- "New on this run" is computed against the pre-run `papers` contents; under the
  single D1 writer this is not contended at this layer.
