## Why

Layer 1's pipeline can run, but nothing in Layer 1 can *start* it — the owner has
no way to ingest on demand, and the Scheduler that would kick runs automatically
is deferred to Layer 2. PL-020 closes that gap: it adds the auth-gated
`triggerRun` console procedure (and a console button) that enqueues a discovery
run and returns its `runId`. The orchestrator's `enqueueDiscovery` entry point
(PL-018) already does the work — it creates a `Run` row and enqueues a `discover`
message; this change exposes it behind the console auth gate (PL-014/PL-015) so
the owner can ingest from Layer 1, with the reader side excluded. The console
prompt procedures (PL-015) and the post controls (PL-021) are merged; this is the
next auth-gated console mutation, and `protectedProcedure` already names
`triggerRun` as an expected console procedure.

## What Changes

- Add `api.triggerRun` — an **auth-gated** oRPC procedure that enqueues a
  discovery run and returns `{ runId }`. It composes on `protectedProcedure`
  (PL-014), so an unauthenticated call returns `401` and never enqueues a run or
  creates a `Run` row.
- `triggerRun` calls the orchestrator's existing `enqueueDiscovery("manual", …)`
  (PL-018), which creates a `Run` row (`trigger = "manual"`, `status = "running"`)
  and enqueues a single `discover` pipeline message carrying the new `runId`. The
  procedure returns that `runId`. No new enqueue/Run logic is reimplemented here.
- Thread the pipeline **queue producer** through the oRPC context (mirroring how
  `db`/`session` are already injected) so the handler can pass it to
  `enqueueDiscovery`; production leaves it for `enqueueDiscovery`'s lazy
  `PIPELINE_QUEUE` bind, and tests inject a recording fake.
- Add a minimal console **"Run now"** button (`apps/web/src/routes/console/index.tsx`)
  that invokes `triggerRun` from the auth-gated console; the reader side has no
  such control and an unauthenticated call is rejected.

## Capabilities

### Modified Capabilities
- `console-api`: extend the auth-gated console surface with `triggerRun` — the
  owner's ingest-on-demand activity — alongside the existing prompt and post
  procedures.

## Impact

- `packages/api/src/routers/run.ts` (new) — add `triggerRun` on
  `protectedProcedure`; calls `enqueueDiscovery("manual", { db, queue })` from the
  context and returns `{ runId }`.
- `packages/api/src/routers/index.ts` — register `triggerRun` in the app router
  (additive; existing `AppRouter` members unchanged).
- `packages/api/src/context.ts` — add a `queue` (pipeline `QueueProducer`) field to
  the oRPC context, the injection seam for `enqueueDiscovery` (prod defers to the
  lazy `PIPELINE_QUEUE` bind; tests inject a fake).
- `packages/api/package.json` — add the `@paperlens/orchestrator` workspace
  dependency (for `enqueueDiscovery` + the `QueueProducer` type).
- `apps/web/src/routes/console/index.tsx` (new) — auth-gated console "Run now"
  button that calls `triggerRun` and surfaces the returned `runId`.
- Consumes the PL-018 `enqueueDiscovery` (and the existing `runs` table + `discover`
  queue message), and the PL-014 `protectedProcedure`. **No D1 schema change** — the
  `runs` table already exists (added with PL-018).
- Downstream: backs the owner's manual ingest in Layer 1; the automatic Scheduler
  is PL-024 (Layer 2), which reuses the same `enqueueDiscovery("cron", …)` entry.
