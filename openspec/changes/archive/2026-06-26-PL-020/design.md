## Context

The console is auth-gated via `protectedProcedure = publicProcedure.use(requireAuth)`
(PL-014, in `packages/api/src/index.ts`; fail-closed 401) — the same gate the
prompt procedures (PL-015) and `setPostStatus` (PL-021) compose on. The
orchestrator (PL-018, `packages/orchestrator/src/index.ts`) already owns the
pipeline entry point:

```ts
enqueueDiscovery(trigger: "manual" | "cron", deps?): Promise<{ runId: string }>
```

It inserts a `Run` row (`runs` table — `trigger`, `status = "running"`, …; PL-018)
and sends one `{ type: "discover", runId }` message to the pipeline queue, then
returns `{ runId }`. Its own comment names the manual trigger (PL-020) as a caller.
So **both acceptance effects — enqueue a discovery message AND create a Run row —
already happen inside `enqueueDiscovery`.** PL-020 is the thin auth-gated console
procedure that calls it, plus the console button. See the `web → api` interface in
`product-context.yaml` (console mutations are auth-gated; the reader side cannot
trigger ingest).

## Goals / Non-Goals

**Goals:**
- `triggerRun` on `protectedProcedure` that calls `enqueueDiscovery("manual", …)`
  and returns `{ runId }`.
- Invoking it enqueues a `discover` message and creates a `Run` row; an
  unauthenticated call is rejected (`401`) and does neither.
- A minimal console "Run now" button that invokes `triggerRun`; the reader side
  has no such control.

**Non-Goals:**
- No change to `enqueueDiscovery` or the pipeline handlers (consume PL-018 as-is).
- **No D1 schema change** — the `runs` table already exists (PL-018); this change
  neither adds nor migrates it.
- No Scheduler / cron cadence (Layer 2, PL-024 — which reuses
  `enqueueDiscovery("cron", …)`).
- No run-status UI / run history view, no polling, no cancel.

## Decisions

- **Compose on `protectedProcedure`** — `triggerRun` inherits the PL-014 gate, so
  the 401 behavior and owner-session check live in one place (do not re-implement
  auth per procedure). Mirror the `prompt.ts` console router structure (PL-015):
  a new `packages/api/src/routers/run.ts` exporting `triggerRun`.
- **Delegate to `enqueueDiscovery`, do not reimplement** — the handler calls
  `enqueueDiscovery("manual", { db: context.db, queue: context.queue })` and
  returns its `{ runId }`. The Run-row insert and the `discover` enqueue stay in
  the orchestrator (single source of truth); `triggerRun` adds only the auth gate
  and the trigger value. The `context.db` is cast to the orchestrator's `CrawlerDb`
  at the call boundary, as the orchestrator's own offline drivers do (same SQLite
  dialect/schema).
- **Thread the queue producer through the oRPC context** — add a `queue`
  (`QueueProducer` from `@paperlens/orchestrator`) field to `Context`, mirroring how
  `db`/`session` are already injected. This is the only seam an oRPC handler has, so
  it is what makes the integration test runnable offline (inject a recording fake
  queue + in-memory db). In production `createContext` leaves `queue` for
  `enqueueDiscovery`'s built-in lazy `PIPELINE_QUEUE` bind (pass `undefined` →
  `resolveQueue` binds the real `PIPELINE_QUEUE`), so no new binding plumbing is
  added to the api.
- **No input** — `triggerRun` takes no arguments (trigger is fixed to `"manual"`);
  it returns `{ runId }`. No zod input schema is needed.
- **Console button is minimal wiring** — `apps/web/src/routes/console/index.tsx`
  adds a "Run now" button that calls `triggerRun` via the credentialed `orpc`
  client (the same auth-gated client `console/posts.tsx` uses) and surfaces the
  returned `runId`. The route is auth-guarded in `beforeLoad` (redirect to `/login`
  when unsigned), matching `console/posts.tsx`.

## Dependency APIs (consumed)

- **PL-018 orchestrator (merged):** `enqueueDiscovery(trigger, deps)` →
  `{ runId }`, the `runs` table, the `discover` queue message, and the
  `QueueProducer` type — all from `@paperlens/orchestrator`. The api package gains a
  `@paperlens/orchestrator` workspace dependency.
- **PL-014 auth (merged):** `protectedProcedure` in `packages/api/src/index.ts`.
- **PL-001/PL-018 persistence (merged):** the `runs` table (`id`, `trigger`,
  `status`, `started_at`, `finished_at`, `stats`); tests use the in-memory
  `bun:sqlite` + the project migration harness (the `posts.test.ts` pattern). No
  new migration.
- The oRPC context already carries `db` + `session` (PL-008 + PL-014); this change
  adds `queue`.

## Risks / Trade-offs

- **At-least-once / double trigger.** Two quick clicks create two `Run` rows and
  two discovery runs. That is acceptable: the pipeline's discover fan-out is
  idempotent at the Paper level (PL-018 resume-from-stage + `ON CONFLICT DO
  NOTHING` dedup), so a duplicate run does not duplicate Papers or output. No
  debounce/lock at this layer.
- **Type seam.** `context.db` (`Db`) and the orchestrator's `CrawlerDb` are
  structurally identical Drizzle SQLite handles but nominally distinct; the call
  casts at the boundary (as the existing offline drivers already do). The injected
  `context.queue` is typed exactly as `enqueueDiscovery`'s `QueueProducer`, so no
  cast is needed there.
- **`runId` is fire-and-forget.** `triggerRun` returns the `runId` but no run
  status; surfacing run progress/history is out of scope (a later console view).
