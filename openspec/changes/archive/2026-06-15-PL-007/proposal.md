## Why

The four pipeline stages — crawler, digestor, stylist, publisher — now each exist
as a package, but nothing wires them together: a paper cannot yet travel from an
arXiv id to a published Post in one motion. This is story PL-007, the Layer-0
inline pipeline. It introduces the orchestrator's first responsibility: run all
four stages in order for a single paper, threading it through the Paper status
machine (discovered → digested → styled → published). Inline (no queue) is fine
for one paper — the LLM is I/O-bound — and lets the owner trigger an end-to-end
run during development. The Cloudflare Queue arrives at Layer 1.

## What Changes

- Add a `packages/orchestrator` module exposing `runOnce(arxivId?, deps?)` that
  runs the four stages inline for one paper and returns the published `Post`:
  crawler.fetchById → digestor.run → stylist.run → publisher.publish.
- `runOnce` accepts injected dependencies (db, llm `complete`, the arXiv metadata
  fetcher, the full-text fetcher) so the whole pipeline is testable offline; each
  defaults to the real client/fetcher in production.
- The run is **idempotent**: if the paper already has a published Post, `runOnce`
  returns it without re-running any stage — a re-run adds no duplicate Paper or
  Post. (The crawler already dedups the Paper by arXiv id.)
- Add a **dev-only** trigger in `apps/server` (`POST /dev/run-once`) that calls
  `runOnce` for a hardcoded arXiv id. It is mounted only outside production and
  does not touch the existing Hono server, auth, or the AppRouter type.

## Capabilities

### New Capabilities

- `orchestrator`: coordinates the PaperLens pipeline. At Layer 0 it runs the four
  stages inline for one paper (`runOnce`) and produces a published Post, idempotently.

### Modified Capabilities

<!-- none -->

## Impact

- `packages/orchestrator` — new module (`runOnce()`), with an offline integration
  test (mocked llm, fixture fetchers, in-memory SQLite db).
- `apps/server/src/index.ts` — adds a guarded, dev-only `POST /dev/run-once` route;
  no change to auth, existing routes, or the AppRouter type (`tsc -b` stays green).
- Consumes `@paperlens/crawler`, `@paperlens/digestor`, `@paperlens/stylist`,
  `@paperlens/publisher`, `@paperlens/llm`, and `@paperlens/db`; no schema change.
- Downstream: the Layer-1 queue-backed orchestrator builds on this inline path.
