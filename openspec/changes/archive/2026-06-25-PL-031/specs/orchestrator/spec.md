## ADDED Requirements

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
