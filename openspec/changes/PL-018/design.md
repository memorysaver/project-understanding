## Context

PaperLens is a serverless modular monolith on Cloudflare Workers. The ingestion
pipeline (`crawler → digestor → stylist → publisher`) is coordinated by the
`orchestrator` module. At Layer 0 (PL-007) the orchestrator ran the four stages
**inline** in one Worker invocation for a single hardcoded paper. PL-018 is the
Layer-1 story that moves the pipeline onto **Cloudflare Queues** with **durable
D1 intermediates** and a **Paper state machine**, per ADR-001.

The constraint that forces this: a Worker invocation can make at most ~1000
subrequests and bills CPU per request. Running every stage (each with its own
LLM call + fetches) for many papers in one invocation blows the budget.
Therefore the architecture is **one LLM call per queue message / stage** — each
stage runs in its own invocation, triggered by its own message.

See `docs/technical-spec.md` §1–§6, the `orchestrator` + `server` modules, the
`ingest-pipeline` protocol sequence, and ADR-001/ADR-003 in `product-context.yaml`.

## Goals / Non-Goals

**Goals:**
- `orchestrator.enqueueDiscovery(trigger)` — the new pipeline entry point: create
  a `Run`, enqueue one `discover` message.
- A queue consumer in `apps/server` (`queue()` handler) that dispatches each
  message by `type` to the matching orchestrator stage handler.
- Per-stage handlers that read the prior durable D1 intermediate, invoke the
  stage module, advance `Paper.status`, and enqueue the next stage.
- Idempotent, resumable stages: a redelivered message resumes from the last good
  intermediate; re-running a stage does not duplicate output or skip backward.
- `failed` terminal state after `max_retries`.

**Non-Goals:**
- Real arXiv batch discovery + dedup (PL-019); manual `triggerRun` oRPC procedure
  (PL-020); `scheduled()` Cron producer + retry escalation/alerting (PL-024);
  abstract-only deferral re-queue (PL-031).
- No changes to stage-module internals or the D1 schema (the `Paper.status` enum
  and `Run` table already exist from PL-001).
- No reader/console UI or oRPC contract change.

## Queue protocol & message shape

A single pipeline Queue carries messages of the shape:

```jsonc
{ "type": "discover" | "digest" | "style" | "publish",
  "arxiv_id"?: string,   // absent on discover; present on digest/style/publish
  "runId": string }
```

| sender (stage that enqueued) | message_type | payload | next |
|---|---|---|---|
| orchestrator (`enqueueDiscovery`) | `discover` | `{type,runId}` | one `digest` per new paper |
| crawler (discovery) | `digest` | `{type,arxiv_id,runId}` | `style` |
| digestor | `style` | `{type,arxiv_id,runId}` | `publish` |
| stylist | `publish` | `{type,arxiv_id,runId}` | (terminal: published) |

- **Discovery is the only fan-out point.** Everything downstream is
  one-paper-per-message, keeping each invocation within CPU/subrequest limits.
- The consumer (`server`) only routes on `type`; all pipeline logic lives in the
  orchestrator's stage handlers. The orchestrator owns transitions + enqueueing;
  stage modules own only their own work and output rows.
- This shape is the **contract** validated by the contract test (see spec).

## State-machine transitions

```
discovered ──digest──▶ digested ──style──▶ styled ──publish──▶ published
     │                    │                   │
     └────────────────────┴───────────────────┴──▶ failed (after N retries)
```

| message | reads (intermediate) | stage call | writes | advance |
|---|---|---|---|---|
| `discover` | — | `crawler` discovery | `Paper(status=discovered)` × N | enqueue `digest` × N |
| `digest` | Paper | `digestor.run` | `Digest`, link to Paper | `discovered → digested`, enqueue `style` |
| `style` | Digest + active StylePrompt | `stylist.run` | styled body | `digested → styled`, enqueue `publish` |
| `publish` | styled body + Paper | `publisher.publish` | `Post(status=published)` | `styled → published` (terminal) |

- A stage is a **pure function of its input intermediate**. Re-running overwrites
  its own output and **re-advances status only if the Paper is not already past**
  that stage. Each stage already writes its output *before* advancing, which is
  what makes a redelivery resume from the last good intermediate.
- `failed` is terminal until a human resets it; `published` is terminal-happy
  (the owner may later move the Post to `unpublished` via the console).

## Decisions

- **ADR-001 — Queue + durable intermediates over in-process chaining.** Each
  stage runs in its own Worker invocation triggered by its own message, so no
  single invocation exceeds the subrequest/CPU budget. Stages communicate only
  through D1 rows, never in-memory state, which is what makes them swappable and
  retries idempotent. This is the whole reason PL-018 exists; PL-007's inline run
  was always the explicitly-deferred skeleton.
- **One LLM call per message.** The CPU/subrequest limit is per-invocation, and
  an LLM `fetch` is mostly idle I/O — the real budget is the *count* of stages
  per invocation. Splitting the pipeline so each message does at most one LLM
  call keeps every invocation safe. `digest` and `style` each make exactly one
  `llm.complete`; `discover` and `publish` make none.
- **Server hosts the consumer; orchestrator holds the logic.** The `queue()`
  handler in `apps/server` is a thin router (`switch (msg.type)`), matching the
  module boundary: `server` owns runtime bindings, `orchestrator` owns pipeline
  logic and state transitions.
- **Idempotency = resume-from-stage, not whole-run short-circuit.** PL-007's
  idempotency returned the existing Post and skipped the entire run. Under the
  queue, idempotency is per message: a stage re-advances status only if the Paper
  has not already passed that stage, and overwrites its own (single-per-Paper)
  output. A redelivered `digest` for an already-`digested` paper re-writes the
  Digest and re-enqueues `style` without regressing status — it never redoes
  `style`/`publish`.
- **D1 for state, Queues for the job queue (ADR-003).** D1 holds Papers/Digests/
  Posts/Runs (with `arxiv_id` UNIQUE dedup); the Queue provides at-least-once
  delivery, backoff retries, and a DLQ. We do not use D1 as a work queue.
- **Single queue, dispatch by `type`** (per technical-spec §4.3, "single queue or
  one per stage"). A single queue keeps the consumer and bindings simplest while
  satisfying the protocol; per-stage queues are not needed for the MVP.

## Dependency APIs (consumed)

All upstream stories are **merged**. The orchestrator calls the existing entry
points without changing them:

- **crawler (PL-003):** `fetchById({ id, db, fetcher? })` → persists a
  `Paper(status=discovered)`, dedup by `arxiv_id` (`ON CONFLICT DO NOTHING`). The
  `discover` handler uses crawler discovery to enumerate new papers.
- **digestor (PL-004):** `run` → loads the Paper, fetches full text, one
  `llm.complete`, persists the `Digest`, advances `discovered → digested`;
  rethrows on LLM failure leaving the Paper untouched (no partial advance).
- **stylist (PL-005):** `run` → loads the Digest + active StylePrompt, one
  `llm.complete`, returns the styled body (+ ids/model), advances
  `digested → styled`; throws on empty body.
- **publisher (PL-006):** `publish` → assembles + persists a `Post(published)`,
  builds the citation, sanitizes the body, advances `styled → published` and
  stamps `published_at`.
- **db (PL-001):** typed Drizzle accessors for Paper/Digest/Post/Run; the
  `Paper.status` enum (`discovered|digested|styled|published|failed`) and the
  `Run` table (trigger, status, stats) already exist.
- **Queue binding:** a pipeline Queue producer (to send) + consumer (in the
  server `queue()` handler), added to the server's wrangler config.

> Note: the digestor/stylist/publisher modules already advance their own
> `Paper.status` on success (per their specs). The orchestrator's job is to drive
> the *transitions between* stages (enqueue the next message) and to own the
> failure transition (`→ failed`) and the resume/idempotency guard — not to
> duplicate the per-stage advance the stage modules already perform.

## Risks / Trade-offs

- **At-least-once delivery means a stage can run twice.** Mitigated by the
  resume-from-stage idempotency guard (re-advance only if not already past;
  single-output-per-Paper invariants from the stage specs). The "idempotent stage
  re-run" unit test pins this.
- **Local testing of Queues.** Wrangler's Queue emulation differs from a unit
  test. We test the orchestrator stage handlers directly (inject db + a message)
  for state-transition + idempotency, validate the message shape with a contract
  test, and run one batch through the wired queue for integration — rather than
  depending on production Queue semantics in unit tests.
- **Discovery fan-out volume.** A large batch enqueues many `digest` messages at
  once; Queue consumer concurrency + D1's single-writer nature could contend.
  Acceptable for the MVP batch sizes; per-stage queues / batching are a later
  scaling lever, not needed now.

## Open question

- **Single queue vs. one queue per stage** is left as a single-queue decision
  (above) per the spec's "single queue or one per stage" latitude; if Queue
  consumer concurrency tuning later needs per-stage isolation, that is a
  binding-config change, not a contract change (the message shape is unaffected).
