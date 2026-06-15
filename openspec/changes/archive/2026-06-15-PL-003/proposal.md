## Why

The PaperLens pipeline starts with discovery: turning an arXiv id into a stored
Paper the rest of the pipeline (digestor → stylist → publisher) can act on.
Without a crawler there is nothing to digest. This is story PL-003 — the first
half of the crawler stage: fetch one paper's metadata by id and persist it as a
`discovered` Paper, deduplicated by arXiv id. arXiv is the only source in MVP
(config.yaml), and the source here is a hardcoded single id rather than a feed —
listing/scheduling come in later stories.

## What Changes

- Add a `packages/crawler` module exposing `fetchById({ id, db, fetcher? })`
  that fetches metadata from the **arXiv API**
  (`export.arxiv.org/api/query?id_list=<id>`) and persists a
  `Paper(status=discovered)`.
- Map the Atom response to the Paper fields (title, abstract, authors) and
  derive `source_url` (abs page), `full_text_url` (HTML rendering) and `pdf_url`
  from the id.
- Dedup on `arxiv_id`: insert `ON CONFLICT DO NOTHING`, so re-fetching the same
  id never creates a duplicate.
- Respect arXiv etiquette: send a custom `User-Agent` and expose the API's
  recommended minimum request interval.
- Inject the HTTP fetcher and the db so the stage is testable against a fixture
  Atom response and an in-memory SQLite db — no real network in tests.

## Capabilities

### New Capabilities

- `crawler`: the discovery stage — fetch an arXiv paper by id and persist a
  Paper in the `discovered` state, deduplicated by arXiv id.

### Modified Capabilities

<!-- none -->

## Impact

- `packages/crawler` — new module (`fetchById()`), with unit + integration tests.
- Consumes `@paperlens/db` (the `papers` table and its `discovered` default).
- No DB schema change (the `papers` table already exists from PL-001), no env,
  api, auth, or UI changes in this story.
- Downstream: unblocks the orchestrator and the digestor, which read
  `discovered` Papers. Feed listing / scheduling are later stories.
