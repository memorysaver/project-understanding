## 1. Batch arXiv query

- [ ] 1.1 Add a batch arXiv query in `packages/crawler/src/arxiv.ts` — query the
  list endpoint (`ARXIV_API_BASE?search_query=...&sortBy=submittedDate&sortOrder=descending&max_results=N`)
  via the injected `FetchLike`, sending the existing `USER_AGENT` header. Reuse
  `ARXIV_API_BASE`; do not add a new HTTP idiom.
- [ ] 1.2 Add a multi-entry Atom parser (alongside `parseArxivAtom`) that maps every
  `<entry>` to `ArxivMetadata` (title, summary/abstract, authors, and the three
  derived URLs from the id), skipping a malformed entry rather than throwing so one
  bad entry does not fail the whole batch.

## 2. discover function

- [ ] 2.1 Add `discover({ db, fetcher?, maxResults?, query? }): Promise<Paper[]>` to
  `packages/crawler/src/index.ts` — fetch the batch, parse it, and for each entry
  insert a Paper with `INSERT ... ON CONFLICT DO NOTHING` on `arxiv_id` (the same
  dedup mechanism `fetchById` uses). `fetcher` defaults to the global `fetch`; export
  the function and its arg/return types. Leave `fetchById` and its exports unchanged.
- [ ] 2.2 Persist-only-new + return new papers: compute which arxiv_ids were not in
  `papers` before this run, persist the batch (dedup insert), and return only the
  newly-persisted Papers (so the orchestrator fans out over new work only).
- [ ] 2.3 Honor arXiv etiquette: if the run issues more than one request (paging),
  space requests by `ARXIV_MIN_INTERVAL_MS`; a single-page run is one request.

## 3. Verification

- [ ] 3.1 Unit test (dedup across runs): running `discover` twice over the same
  fixture batch leaves each paper exactly once and the second run persists/returns no
  new papers. Use the in-memory `bun:sqlite` + PL-001 migration harness and a
  fixture-backed `FetchLike` (the `crawler.test.ts` pattern); no real network.
- [ ] 3.2 Integration test (discovery persists only new papers): seed some papers
  (e.g. via `fetchById` or a prior `discover`), then run `discover` over a batch that
  overlaps them — assert only the not-yet-seen papers are persisted as new
  `discovered` Papers, the overlapping ones are unchanged, and the return value is
  exactly the new papers.
- [ ] 3.3 Unit test (User-Agent): a `discover` request carries the custom `USER_AGENT`
  header (assert on the recorded fixture-fetcher call).
- [ ] 3.4 `bun run check-types` passes repo-wide.
