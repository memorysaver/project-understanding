## 1. crawler package

- [x] 1.1 Create `packages/crawler` package (package.json, tsconfig, exports)
      following the monorepo's `@paperlens/*` package conventions; depend on
      `@paperlens/db`.
- [x] 1.2 Implement an arXiv API client + Atom parser: query
      `export.arxiv.org/api/query?id_list=<id>`, send a custom User-Agent, and parse
      the entry into title, abstract, authors, with `source_url`/`full_text_url`/
      `pdf_url` derived from the id. Expose the recommended minimum request interval.
- [x] 1.3 Implement `fetchById({ id, db, fetcher? })`: fetch metadata, then insert
      a `Paper(status=discovered)` with `ON CONFLICT DO NOTHING` on `arxiv_id`;
      return the persisted Paper. Inject the db and HTTP fetcher for testability.

## 2. Verification

- [x] 2.1 Unit test: metadata mapping — the Atom fixture maps to title, abstract,
      authors and the three derived URLs (entities decoded, whitespace collapsed).
- [x] 2.2 Integration test (AC 1): `fetchById` with a fixture fetcher + in-memory
      SQLite db persists a Paper with title, abstract, source_url, full_text_url in
      the `discovered` state, and the row exists in the db.
- [x] 2.3 Unit/integration test (AC 2): re-fetching the same id does not create a
      duplicate and does not overwrite the stored Paper.
- [x] 2.4 Test the rate-limit etiquette (custom User-Agent on the request) and
      that injecting a fetcher means the real network is never used.
