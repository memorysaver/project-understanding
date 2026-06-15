## 1. orchestrator module

- [x] 1.1 Create `packages/orchestrator` (package.json, tsconfig, exports)
      following the monorepo's `@paperlens/*` package conventions, consuming
      `@paperlens/crawler`, `@paperlens/digestor`, `@paperlens/stylist`,
      `@paperlens/publisher`, `@paperlens/llm`, and `@paperlens/db`.
- [x] 1.2 Implement `runOnce(arxivId?, deps?)` that runs the four stages inline
      and in order — `crawler.fetchById` → `digestor.run` → `stylist.run` →
      `publisher.publish` — threading the paper through the status machine and
      returning the published `Post`.
- [x] 1.3 Accept injected dependencies (db, llm `complete`, arXiv metadata
      fetcher, full-text fetcher); default each to the real client/fetcher.
      Import the real `createDb` lazily so the package loads under `bun test`
      (the `@paperlens/db` root pulls `cloudflare:workers`).
- [x] 1.4 Make `runOnce` idempotent: short-circuit and return the existing
      published Post when one already exists, so a re-run adds no duplicate Paper
      or Post. Seed the default active StylePrompt only when none is active.

## 2. dev-only server trigger

- [x] 2.1 Add a guarded, dev-only `POST /dev/run-once` route in
      `apps/server/src/index.ts` that calls `runOnce`; mount it only outside
      production. Do not change the existing server, auth, or AppRouter type.

## 3. Verification

- [x] 3.1 Integration test (in-memory db, fixture arXiv fetch, fixture full-text,
      mocked llm): `runOnce` produces a published Post end-to-end, offline.
- [x] 3.2 Integration test: a second `runOnce` for the same id adds no duplicate
      Paper, Digest, or Post and returns the same published Post.
- [x] 3.3 Integration test: `runOnce` runs against a fresh db with no pre-seeded
      StylePrompt, seeding exactly one active prompt.
- [x] 3.4 Repo-wide `bun run check-types` passes — the server edit keeps
      `server:check-types` (`tsc -b`) green.
