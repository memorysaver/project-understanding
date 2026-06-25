## 1. Schema: source_kind column + migration

- [x] 1.1 Add a `source_kind` column to the `digests` table in
  `packages/db/src/schema/paperlens.ts` —
  `text("source_kind", { enum: ["full_text", "abstract"] }).notNull()` with a
  `full_text` default; export a `digestSourceKinds` const + `DigestSourceKind` type
  alongside the existing `paperStatuses` / `postStatuses` enums.
- [x] 1.2 Regenerate the drizzle migration into `packages/db/src/migrations/` via
  `bun run db:generate` (do not hand-write SQL); confirm the new migration is purely
  additive (one column) and applies cleanly over the PL-001 baseline.

## 2. Digestor sets source_kind

- [x] 2.1 In `packages/digestor/src/index.ts` `run`, set
  `sourceKind: abstractOnly ? "abstract" : "full_text"` on the inserted Digest row,
  using the existing `abstractOnly` signal. Do not change the full-text-vs-abstract
  detection or `ABSTRACT_ONLY_GUARD`.

## 3. Orchestrator defer-with-backoff + bounded flag fallback

- [x] 3.1 In `packages/orchestrator/src/index.ts` `handleDigest`, after the Digest
  exists, read its `source_kind`. For `full_text`, enqueue `style` as today.
- [x] 3.2 For `source_kind = abstract` and within the deferral budget, **defer**: do
  not enqueue `style`; re-enqueue the paper for a later `digest` retry with a backoff,
  reusing the existing `queue.send` requeue idiom. Track the retry count (on the
  requeued message / a durable counter) so the budget is enforceable and a redelivery
  does not reset it.
- [x] 3.3 For `source_kind = abstract` with the deferral budget exhausted, **bounded
  fallback**: publish the paper with an explicit lower-confidence abstract-only flag
  (derived from `source_kind = abstract`) instead of deferring forever or publishing
  blind. Record the policy.

## 4. Re-digest on full text

- [x] 4.1 Relax the at/past-`digested` resume guard in `handleDigest` only for an
  abstract-only Digest so the digestor re-runs on retry; if it now produces
  `full_text`, advance normally; if still `abstract`, defer again (or flag at the
  budget). Preserve the single-current-Digest-per-Paper invariant (re-digest replaces,
  does not accumulate).

## 5. Verification

- [x] 5.1 Unit test (digestor): a digest produced from full text records
  `source_kind = full_text`; a digest produced from the abstract fallback records
  `source_kind = abstract`.
- [x] 5.2 Unit test (orchestrator defers): an abstract-only paper does not enqueue
  `style`, is re-enqueued for a later `digest` retry, and a redelivery does not reset
  the backoff.
- [x] 5.3 Unit test (orchestrator flags at budget): an abstract-only paper whose
  deferral budget is exhausted is published with the explicit lower-confidence flag,
  not deferred again.
- [x] 5.4 Unit test (re-digest): a paper whose current Digest is `abstract`, when
  retried with full text now available, is re-digested to `source_kind = full_text`
  before proceeding to publish.
- [x] 5.5 Integration test: an abstract-only paper driven through the pipeline is not
  published as a normal post (it is deferred, or flagged at the budget) — assert no
  normal published Post is produced for an abstract-only paper still within budget.
- [x] 5.6 `bun run check-types` passes repo-wide.
