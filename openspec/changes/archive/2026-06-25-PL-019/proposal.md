## Why

The crawler's L0 capability (PL-003) is `fetchById` — discover **one** arXiv id
the caller already knows. The pipeline's `discover` fan-out (PL-018) only stands
in for real discovery: `handleDiscover` enumerates a fixed `DISCOVERY_SEED` of
hardcoded ids. PL-019 turns that stand-in into real discovery: the crawler queries
arXiv for a **batch** of recent papers, dedups by `arxiv_id`, and persists only the
papers it has not seen before — so the orchestrator fans out over genuinely new
work, and a manual re-run (PL-020) is safe (no duplicate Papers, no re-fan-out).

## What Changes

- Add `discover({ db, fetcher?, ... })` to `@paperlens/crawler` — query the arXiv
  API for a batch of recent papers (the list endpoint, sorted by submission date),
  parse the Atom feed into per-paper metadata, and persist each as a Paper in the
  `discovered` state via `INSERT ... ON CONFLICT DO NOTHING` on `arxiv_id` (the
  same dedup mechanism `fetchById` uses).
- `discover` returns only the papers that were **newly** persisted on this run (the
  ids not already stored), so the orchestrator's `discover` handler fans out one
  `digest` message per new paper instead of enumerating a fixed seed.
- Honor arXiv etiquette already established in the crawler: send the custom
  `USER_AGENT` on every request and expose / respect `ARXIV_MIN_INTERVAL_MS` (the
  ~3s minimum interval) so a multi-request discovery does not exceed the rate limit.

## Capabilities

### Modified Capabilities
- `crawler`: gains batch discovery + dedup over a set of recent papers
  (`discover`), persisting only new Papers, alongside the existing single-id
  `fetchById`. The dedup-by-`arxiv_id` and rate-limit/User-Agent guarantees extend
  from one id to a batch.

## Impact

- `packages/crawler/src/index.ts` — add the `discover` function (and its arg/return
  types); reuse the existing `arxiv.ts` fetch idiom, `USER_AGENT`,
  `ARXIV_MIN_INTERVAL_MS`, and the `papers` table dedup insert. Additive — `fetchById`
  and its exports are unchanged.
- Consumes the PL-001 `papers` table + the `arxiv_id` PRIMARY KEY dedup invariant
  via the injected `CrawlerDb` (db accessors). No D1 schema change.
- Downstream (PL-018 orchestrator): `handleDiscover` can replace its `DISCOVERY_SEED`
  loop with a single `discover(...)` call and fan out over the returned new papers.
  Wiring `handleDiscover` to call `discover` is left to the orchestrator's own
  follow-up; this change only adds the crawler capability it depends on.
