## 1. Queue binding & message contract

- [x] 1.1 Add a pipeline Queue binding (producer + consumer) to the server's
  wrangler config, and define the message type
  `{ type: "discover"|"digest"|"style"|"publish", arxiv_id?: string, runId: string }`
  as a shared TypeScript type in `packages/orchestrator`. `DB` (D1) is already
  bound; do not change the D1 schema.

## 2. enqueueDiscovery (producer)

- [x] 2.1 In `packages/orchestrator/src/index.ts`, implement
  `enqueueDiscovery(trigger)` that creates a `Run` (recording its trigger) via
  the `db` accessors and enqueues a single `discover` message carrying the new
  `runId`. Accept injected `db` and queue producer; default to the real ones.

## 3. Per-stage dispatch in the orchestrator

- [x] 3.1 Implement the `discover` handler: enumerate new Papers (persisted via
  `crawler.fetchById`, dedup by `arxiv_id`) and enqueue one `digest` message per
  *new* paper — the only fan-out point. (Real arXiv batch query is PL-019; here
  a small fixed seed is sufficient to exercise the path.)
- [x] 3.2 Implement the `digest` handler: load the Paper, call `digestor.run`
  (one LLM call), confirm the `Digest` intermediate is persisted and the Paper
  advanced to `digested`, then enqueue `style`.
- [x] 3.3 Implement the `style` handler: load the `Digest` intermediate + active
  StylePrompt, call `stylist.run` (one LLM call), persist the styled body,
  confirm the Paper advanced to `styled`, then enqueue `publish`.
- [x] 3.4 Implement the `publish` handler: load the styled body + Paper, call
  `publisher.publish` to persist a `Post(published)`, confirm the Paper advanced
  to `published` (terminal — no next message enqueued).

## 4. Idempotency, resume & failure

- [x] 4.1 Add the resume-from-stage guard: a stage re-advances `Paper.status`
  only when the Paper is not already past that stage, and overwrites only its own
  single-per-Paper output, so a redelivered message neither duplicates output nor
  regresses status nor redoes prior stages.
- [x] 4.2 On a stage that exhausts `max_retries`, set `Paper.status = failed`,
  record the failure on the `Run`, and enqueue no further stage for that paper.

## 5. Server queue consumer

- [x] 5.1 In `apps/server/src/index.ts`, add the `queue()` consumer that reads
  each message's `type` and dispatches to the matching orchestrator stage
  handler; reject an unknown `type` without advancing any Paper. Keep the handler
  a thin router (no pipeline logic).
- [x] 5.2 Remove the dev-only `POST /dev/run-once` route and the inline `runOnce`
  it called; remove orphaned imports. Leave the `fetch` handler, auth, and
  `AppRouter` type unchanged.

## 6. Verification

- [x] 6.1 Unit test (state transitions): each stage handler advances
  `Paper.status` correctly (`discovered → digested → styled → published`) and
  enqueues the right next message.
- [x] 6.2 Unit test (idempotent stage re-run): a redelivered `digest` for an
  already-`digested` Paper overwrites the Digest in place, does not regress
  status or redo later stages, and re-enqueues `style`.
- [x] 6.3 Unit test (failure): a stage that exhausts `max_retries` marks the
  Paper `failed`, records it on the `Run`, and enqueues no next stage.
- [x] 6.4 Contract test (queue message shape): `discover`/`digest`/`style`/
  `publish` messages match `{ type, arxiv_id?, runId }` — `discover` omits
  `arxiv_id`, the rest carry it — and round-trip through the consumer's dispatch.
- [x] 6.5 Integration test (batch): a discovery enqueue run, driven through the
  wired queue with a mocked llm + fixture fetchers, produces published Posts for
  a batch of papers.
- [x] 6.6 Repo-wide `bun run check-types` passes; the server edit keeps
  `server:check-types` (`tsc -b`) green.

## Notes

- One LLM call per message (Workers CPU/subrequest limit): `digest` and `style`
  each make exactly one `llm.complete`; `discover` and `publish` make none.
- Manual `triggerRun` (PL-020), Cron producer + retry escalation/alerting
  (PL-024), real arXiv batch discovery (PL-019), and abstract-only deferral
  (PL-031) are out of scope — they build on `enqueueDiscovery` and this dispatch.
