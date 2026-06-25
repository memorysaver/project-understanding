# orchestrator Specification

## Purpose
TBD - created by archiving change PL-007. Update Purpose after archive.
## Requirements
### Requirement: Idempotent re-run adds no duplicate Paper or Post

The system SHALL make a stage re-run idempotent for a given Paper: a redelivered
message SHALL resume from the last good durable intermediate and SHALL NOT create
a duplicate Paper, Digest, or Post, nor redo prior stages. A stage SHALL overwrite
only its own (single-per-Paper) output and SHALL re-advance `Paper.status` only
when the Paper is not already past that stage.

#### Scenario: Redelivered digest message resumes without duplicating or regressing

- **WHEN** a `digest` message is delivered for a Paper that is already `digested`
- **THEN** the Digest for that Paper is overwritten in place (still exactly one
  Digest), the Paper's status is not regressed below `digested`, the `style`
  message is enqueued, and no `style`/`publish` work from a later stage is redone

### Requirement: Dependency-injected stages for offline testability

The system SHALL allow the per-stage handlers to receive injected dependencies —
the database, the queue producer, the llm `complete` client, and the arXiv
metadata / full-text fetchers — so a stage handler can run offline against a
mocked llm, fixture fetchers, an in-memory database, and a fake queue, and SHALL
default each dependency to the real client/fetcher/binding when not supplied.

#### Scenario: A stage handler runs with mocked dependencies

- **WHEN** a stage handler is invoked with an in-memory database, a fake queue
  producer, a fixture full-text fetcher, and a mocked llm `complete`
- **THEN** the stage completes without any network access, advances the Paper's
  status, and records the next message on the fake queue

### Requirement: Enqueue a discovery run that fans out per new paper

The system SHALL provide `enqueueDiscovery(trigger)` that creates a `Run`
(recording its trigger) and enqueues a single `discover` producer message. When
the `discover` message is handled, the system SHALL enqueue exactly one `digest`
message per *new* Paper, so a discovery enqueue fans out one digest message per
new paper. Discovery SHALL be the only fan-out point in the pipeline.

#### Scenario: A discovery enqueue fans out one digest message per new paper

- **WHEN** `enqueueDiscovery` is called and the `discover` message is handled
  against a discovery source that yields N new papers
- **THEN** a `Run` exists for the trigger, N Papers are persisted in the
  `discovered` state, and exactly N `digest` messages — one per new paper, each
  carrying that paper's `arxiv_id` and the `runId` — are enqueued

### Requirement: Queue consumer dispatches each message to its stage

The system SHALL host a Queue consumer in the server (`queue()` handler) that
reads each message's `type` and dispatches `discover | digest | style | publish`
to the matching orchestrator stage handler, and SHALL NOT contain any pipeline
logic itself. An unknown `type` SHALL be rejected without advancing any Paper.

#### Scenario: Each message type routes to its stage

- **WHEN** the queue consumer receives a message
- **THEN** a `discover` message runs discovery, a `digest` message runs the
  digestor stage, a `style` message runs the stylist stage, and a `publish`
  message runs the publisher stage, each via the orchestrator

### Requirement: Each stage reads a durable intermediate, advances status, and enqueues the next

The system SHALL, for each downstream stage message, load that stage's input from
the durable D1 intermediate written by the prior stage, invoke the corresponding
stage module, advance `Paper.status` along `discovered → digested → styled →
published`, and enqueue the next stage's message — performing at most **one LLM
call per message**. A stage SHALL write its own durable intermediate before
enqueuing the next stage.

#### Scenario: A stage advances Paper.status and enqueues the next

- **WHEN** a `digest` message is handled for a `discovered` Paper
- **THEN** the digestor produces a `Digest` from the Paper's full text (one LLM
  call), the `Digest` is persisted, the Paper advances to `digested`, and a
  `style` message for that paper is enqueued

#### Scenario: A stage retry resumes from the last good intermediate

- **WHEN** the `style` stage failed for a `digested` Paper (no styled body
  written, status still `digested`) and the `style` message is redelivered
- **THEN** the stylist re-reads the existing `Digest` intermediate, produces the
  styled body, advances the Paper to `styled`, and enqueues `publish` — without
  re-running discovery or digest

### Requirement: A stage failure marks the Paper failed after max retries

The system SHALL, when a stage exceeds its retry budget, set the Paper's status
to `failed` and record the failure on the `Run`, leaving the Paper at `failed`
(terminal until a human resets it) and not enqueuing any further stage for it.

#### Scenario: A persistently failing stage marks the Paper failed

- **WHEN** a stage for a Paper has been retried up to `max_retries` and still
  fails
- **THEN** the Paper's status becomes `failed`, the failure is recorded on the
  `Run`, and no next-stage message is enqueued for that Paper

### Requirement: Pipeline queue message shape (contract)

The system SHALL emit pipeline queue messages of the shape `{ type, arxiv_id?,
runId }` where `type` is one of `discover | digest | style | publish` and `runId`
is the discovery run's id. The `discover` message SHALL omit `arxiv_id`; the
`digest`, `style`, and `publish` messages SHALL each carry the target paper's
`arxiv_id`. The consumer SHALL accept exactly this shape and reject any other.

#### Scenario: Enqueued messages conform to the documented shape

- **WHEN** the orchestrator enqueues a `discover` message and then a per-paper
  `digest` message
- **THEN** the `discover` message is `{ "type": "discover", "runId": "..." }`
  with no `arxiv_id`, and the `digest` message is `{ "type": "digest",
  "arxiv_id": "...", "runId": "..." }` — both validating against the contract and
  round-tripping through the consumer's type dispatch

### Requirement: Abstract-only papers are deferred or flagged, never published blind

The orchestrator SHALL NOT publish an abstract-only paper (its current Digest has
`source_kind = abstract`) as a normal post. On an abstract-only Digest the `digest`
stage SHALL instead **defer** the paper — re-enqueue it for a later `digest` retry
with a backoff, reusing the existing queue requeue idiom — so it can be re-digested
once full text becomes available, rather than advancing it to `style`/`publish`. The
defer-vs-flag policy SHALL be recorded.

#### Scenario: An abstract-only paper is deferred instead of published as a normal post

- **WHEN** the `digest` stage produces (or loads) a Digest with `source_kind = abstract`
  for a paper still within its deferral budget
- **THEN** the orchestrator does not enqueue the `style` stage for that paper and
  instead re-enqueues the paper for a later `digest` retry (backoff), so the paper is
  never published as a normal post

### Requirement: An abstract-only paper that gains full text is re-digested before publish

The orchestrator SHALL, when a deferred abstract-only paper is retried and full text
is now available, re-digest the paper from the full text — replacing the abstract-only
Digest with a `full_text` one (preserving the single-current-Digest-per-Paper
invariant) — before the paper proceeds to `style`/`publish`. The at/past-`digested`
resume guard SHALL be relaxed only for an abstract-only Digest, so a `full_text` Digest
is never re-run.

#### Scenario: A paper that was abstract-only is re-digested from full text on retry

- **WHEN** a paper whose current Digest is `source_kind = abstract` is retried and the
  full-text fetcher now returns the rendered full text
- **THEN** the orchestrator re-digests the paper from the full text, the paper's
  current Digest becomes `source_kind = full_text`, and only then does the paper
  proceed toward publish

### Requirement: Bounded fallback publishes an abstract-only paper with an explicit flag

The orchestrator SHALL bound deferral: when a paper is still abstract-only after its
deferral budget is exhausted, it SHALL NOT defer indefinitely and SHALL NOT publish
blind. Instead it SHALL publish the paper with an explicit lower-confidence
abstract-only flag (derived from the persisted `source_kind = abstract`), so the
post is distinguishable from a normal post. This bounded-fallback policy is recorded.

#### Scenario: A paper that never gains full text is published flagged, not deferred forever

- **WHEN** a paper's current Digest is still `source_kind = abstract` after its
  deferral budget is exhausted (full text never rendered)
- **THEN** the orchestrator stops deferring and publishes the paper with an explicit
  lower-confidence abstract-only flag, so it is neither deferred indefinitely nor
  published as a normal post

