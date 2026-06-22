# Retrieval Instructions — PL-018

## Files to read first
- `packages/orchestrator/src/index.ts` — the L0 `runOnce` this story replaces;
  reuse its dependency-injection shape (db, llm, fetchers) for the stage handlers.
- `apps/server/src/index.ts` — the Hono Worker entry; where the `queue()`
  consumer is added and the dev-only `POST /dev/run-once` route is removed.
- `packages/{crawler,digestor,stylist,publisher}/src/index.ts` — the stage entry
  points the dispatch calls (`fetchById` / `run` / `run` / `publish`); match
  their argument shapes and how they advance `Paper.status`.
- `packages/db/src/**` — the Drizzle accessors + `Paper.status` enum + `Run`
  table the orchestrator reads/writes.
- `docs/technical-spec.md` §1, §3, §4.3, §5, §6 — the Workers constraint, the
  Paper state machine, the queue interface, the protocol sequence, failure classes.

## Patterns to explore
- How `apps/server` defines its Worker handlers and bindings (`fetch`, env types),
  so the `queue()` handler and the new Queue binding match the existing wiring.
- How a Cloudflare Queue producer is bound and a consumer batch is iterated in
  this stack — check the wrangler config and the project's binding-types pattern.
- How PL-007's `runOnce` injected dependencies and ran offline; carry that
  pattern into per-stage handlers so unit tests inject db + a fake queue + a
  mocked llm.
- How each stage module already advances `Paper.status` — so the orchestrator
  drives transitions *between* stages without double-advancing.

## Do not read
- Reader/console UI (`apps/web`) and oRPC routers (`packages/api`) — unchanged
  here; `triggerRun` is PL-020, not this story.
- Better Auth tables/schema and the D1 migrations — untouched (no schema change).
- The `llm` module internals — consumed only through the stage modules; the
  orchestrator never calls `llm.complete` directly.
