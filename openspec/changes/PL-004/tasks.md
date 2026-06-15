## 1. digestor package

- [x] 1.1 Create `packages/digestor` (package.json, tsconfig, exports) following
  the `@paperlens/*` package conventions; depend on `@paperlens/db` and
  `@paperlens/llm`.
- [x] 1.2 Define `digestSchema` (Zod) for the Digest shape: non-empty
  `contributions`, `methods`, `results`.
- [x] 1.3 Implement an injectable `FullTextFetcher` with a default
  `fetchArxivFullText` that prefers the arXiv HTML source and falls back to the
  abstract (no PDF binary parsing).
- [x] 1.4 Implement `run({ paperId, db, fetchFullText?, complete? })`: load the
  Paper, fetch full text, call `llm.complete({ stage: "digest", schema })`,
  then persist the Digest and advance the Paper to `digested` in one transaction.
- [x] 1.5 On LLM failure, rethrow before any write so the Paper stays at
  `discovered` (no partial advance).

## 2. Verification

- [x] 2.1 Unit: digest output validates against `digestSchema` (contract test of
  the Digest shape).
- [x] 2.2 Unit: a successful run persists the Digest, links it to the Paper, and
  advances the Paper to `digested`.
- [x] 2.3 Unit: an LLM failure rethrows and leaves the Paper at `discovered` with
  no Digest written.
- [x] 2.4 Integration: full-text fetch (fixture) -> digest on a fixture Paper with
  a mocked `llm` returning a canned structured digest (no network).
- [x] 2.5 Unit: the default fetcher prefers the HTML source and falls back to the
  abstract.
