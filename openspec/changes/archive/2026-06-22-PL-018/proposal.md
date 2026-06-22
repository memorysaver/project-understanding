## Why

PL-007 gave the orchestrator a Layer-0 `runOnce` that runs all four stages
inline, in one Worker invocation, for a single hardcoded paper. That walking
skeleton proved the end-to-end path but does not scale: Cloudflare Workers cannot
run the whole `crawl → digest → style → publish` chain for many papers in one
invocation (subrequest cap, CPU per request), and an inline run has no resume
point — a failure mid-chain redoes everything.

PL-018 replaces the inline run with the real architecture from **ADR-001**: the
pipeline runs over **Cloudflare Queues**, one message per `(paper, stage)`, each
stage reading the previous **durable D1 intermediate**, doing exactly **one LLM
call**, writing its own intermediate, advancing `Paper.status`, and enqueuing the
next stage. The `server` Worker hosts the Queue consumer that dispatches each
message to the right stage. This makes the pipeline scalable (fan-out at
discovery, one paper per message), resumable (a retry resumes from the last good
intermediate), and idempotent (re-running a stage is a no-op when already past).

## What Changes

- Add `orchestrator.enqueueDiscovery(trigger)` — creates a `Run` and enqueues a
  single `discover` producer message. This is the new pipeline entry point that
  the manual trigger (PL-020) and Cron (PL-024) call.
- Add a **queue consumer dispatch** in `apps/server/src/index.ts` (`queue()`
  handler) that reads each message's `type` and dispatches it to the matching
  stage path in the orchestrator.
- The orchestrator gains a per-stage handler for `discover | digest | style |
  publish`. Each downstream stage handler loads its input intermediate from D1,
  invokes the existing stage module (`crawler` / `digestor` / `stylist` /
  `publisher`), advances `Paper.status`, and enqueues the next stage's message.
  **Discovery** is the only fan-out point: it enqueues one `digest` message per
  *new* paper.
- A stage is **idempotent**: re-running it overwrites its own output and
  re-advances `status` only if the paper is not already past that stage, so a
  Queue redelivery resumes from the last good intermediate without redoing prior
  stages.
- After `max_retries` on a stage, the orchestrator sets `Paper.status = failed`
  and records the failure on the `Run` (escalation per failure class is L2,
  PL-024).
- **Remove** the Layer-0 inline `runOnce` and its dev-only `POST /dev/run-once`
  trigger — superseded by the queue path.

## Capabilities

### New Capabilities

- `orchestrator`: queue-coordinated pipeline. `enqueueDiscovery` fans a run out
  over Cloudflare Queues; a per-stage dispatch advances each Paper through the
  state machine (`discovered → digested → styled → published`, or `failed`),
  with durable D1 intermediates and idempotent, resumable stages. One LLM call
  per message.

### Modified Capabilities

- `orchestrator`: the inline single-paper `runOnce` (run all four stages in one
  invocation) is replaced by the queue dispatch. Idempotency moves from
  "short-circuit if a published Post exists" (whole-run) to per-stage
  "re-advance only if not already past" (resume-from-stage).

## Impact

- `packages/orchestrator/src/index.ts` — replace `runOnce` with
  `enqueueDiscovery(trigger)` + the per-stage dispatch (`discover`/`digest`/
  `style`/`publish`). Consumes the existing stage entry points
  (`crawler.fetchById`, `digestor.run`, `stylist.run`, `publisher.publish`) and
  the `db` accessors; reads/writes `Paper.status` and `Run` rows.
- `apps/server/src/index.ts` — add the `queue()` consumer that dispatches each
  message to the orchestrator; remove the dev-only `POST /dev/run-once` route.
  The `fetch` handler, auth, and `AppRouter` type are unchanged.
- Bindings: a pipeline Queue producer/consumer binding is added to the server
  Worker (wrangler config). `DB` (D1) is already bound.
- Downstream: unblocks PL-019 (batch discovery in the crawler), PL-020 (manual
  `triggerRun`), PL-024 (Cron producer + retries/escalation), and PL-031
  (abstract-only deferral re-queues on this path). All of them build on
  `enqueueDiscovery` and the per-stage dispatch.

## Deferred

- **Batch arXiv discovery** — the `discover` handler enqueues one `digest`
  message per *new* paper, but real arXiv querying + dedup over a batch is
  PL-019. This story may discover from a small fixed seed so the queue path is
  exercisable end-to-end.
- **Manual `triggerRun` procedure and Cron producer** — `enqueueDiscovery` is
  the callable; wiring it to an auth-gated oRPC procedure is PL-020 and to a
  `scheduled()` handler is PL-024.
- **Retry escalation / owner alerting** — marking a Paper `failed` after
  `max_retries` is in scope; alerting the owner per failure class is L2 (PL-024).
- **Abstract-only deferral** (re-queue with backoff) is PL-031.
