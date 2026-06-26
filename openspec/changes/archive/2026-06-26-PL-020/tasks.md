## 1. Wire the orchestrator dependency + context seam

- [ ] 1.1 Add the `@paperlens/orchestrator` workspace dependency to
  `packages/api/package.json` (for `enqueueDiscovery` + the `QueueProducer` type).
- [ ] 1.2 In `packages/api/src/context.ts`, add a `queue` field (pipeline
  `QueueProducer` from `@paperlens/orchestrator`) to `Context` — the injection seam
  for `enqueueDiscovery`. In `createContext`, leave it `undefined` in production so
  `enqueueDiscovery` lazily binds the real `PIPELINE_QUEUE` (no new binding
  plumbing). Existing `db`/`session` fields unchanged.

## 2. triggerRun procedure

- [ ] 2.1 Add `triggerRun` to a new `packages/api/src/routers/run.ts` on
  `protectedProcedure` (PL-014), mirroring the `prompt.ts` console router. No input.
  The handler calls `enqueueDiscovery("manual", { db: context.db, queue: context.queue })`
  (casting `context.db` to the orchestrator's `CrawlerDb` at the boundary, as the
  orchestrator's offline drivers do) and returns its `{ runId }`. Do not reimplement
  the Run-row insert or the enqueue — delegate to the orchestrator.

## 3. Wire into the app router

- [ ] 3.1 Register `triggerRun` in `packages/api/src/routers/index.ts` alongside the
  existing console procedures. Leave the reader procedures on `publicProcedure` and
  the existing `AppRouter` members unchanged.

## 4. Console wiring (web)

- [ ] 4.1 Add `apps/web/src/routes/console/index.tsx` with an auth-gated "Run now"
  button that calls `triggerRun` via the credentialed `orpc` client and surfaces the
  returned `runId` (minimal wiring; reuse the `console/posts.tsx` `beforeLoad` auth
  redirect pattern).

## 5. Verification

- [ ] 5.1 Unit test (auth required): `triggerRun` called without a session returns
  `401` (`ORPCError("UNAUTHORIZED")`) and does NOT create a `Run` row or enqueue a
  message (assert against an injected recording fake queue + in-memory db, per the
  PL-014 handler-side sentinel pattern). Inject the context (db + queue); never call
  the prod `createContext`.
- [ ] 5.2 Integration test (trigger → run via queue): an authenticated `triggerRun`
  creates exactly one `Run` row (`trigger = "manual"`) and the injected fake queue
  records exactly one `{ type: "discover", runId }` message whose `runId` matches the
  returned `runId`. Use the in-memory `bun:sqlite` + project migration harness and a
  recording fake `QueueProducer`; no Cloudflare binding or network.
- [ ] 5.3 Contract test (triggerRun shape): `triggerRun`'s result is `{ runId: string }`
  (the shape the console button consumes), pinned against the procedure's output.
- [ ] 5.4 `bun run check-types` passes repo-wide.
