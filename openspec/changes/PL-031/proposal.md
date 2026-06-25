## Why

The digestor already detects when only a paper's abstract is available (PL-030:
`abstractOnly = fullText.trim() === paper.abstract.trim()`) and steers the LLM
with the `ABSTRACT_ONLY_GUARD` so it does not invent specifics. But that signal
is **thrown away** after the digest is built: the produced Digest carries no
record of whether it came from full text or only the abstract, and the
orchestrator publishes an abstract-only paper through the same `digest → style →
publish` path as a full-text one. An abstract-only digest is a known
lower-confidence artifact (the dominant faithfulness defect the L0 gate found),
yet today it is published blind as a normal post.

PL-031 persists a `source_kind` (`full_text | abstract`) on each Digest and makes
the orchestrator **act** on it: an abstract-only paper is **deferred** —
re-queued with backoff so it is re-digested once arXiv (ar5iv) renders full text
(typically within ~2 days) — rather than published as a normal post. The
**publish-FLAGGED** path is the bounded fallback for a paper that never gains
full text, so the system never defers forever and never blind-publishes.

## What Changes

- Persist a `source_kind` column (`full_text | abstract`) on the `digests` table;
  the digestor sets it from the abstract-only signal it already computes. A paper
  digested from the abstract alone is queryable as such.
- The orchestrator's `digest` handler, on an abstract-only Digest, **defers**
  instead of advancing to `style`/`publish`: it re-enqueues the paper for a later
  retry (backoff), reusing the existing requeue/enqueue idiom. On retry, if full
  text is now available the paper is **re-digested from the full text** before it
  proceeds to publish.
- **Bounded fallback (recorded policy):** once a deferral budget is exhausted (the
  paper still has no full text after the allowed retries), the paper is **not**
  deferred forever — it is published with an explicit lower-confidence
  abstract-only flag, so it never blind-publishes and never defers indefinitely.
- An abstract-only paper is therefore **never** published as a normal post: it is
  either deferred for re-digest from full text, or published with the explicit
  flag.

## Capabilities

### Modified Capabilities
- `orchestrator`: the `digest` stage gains an abstract-only branch — defer (re-queue
  with backoff for re-digest once full text renders) or, when the deferral budget
  is exhausted, publish with an explicit lower-confidence flag. An abstract-only
  paper never proceeds through the normal `digest → style → publish` path blind.
- `digestor`: the produced Digest records its `source_kind` (`full_text | abstract`)
  from the abstract-only signal the digestor already detects, so downstream stages
  can act on the paper's confidence level.

## Impact

- `packages/db/src/schema/paperlens.ts` — add a `source_kind` column to `digests`
  (`text({ enum: ["full_text", "abstract"] })`); regenerate the drizzle migration
  into `packages/db/src/migrations/`.
- `packages/digestor/src/index.ts` — set `sourceKind` on the inserted Digest from
  the existing `abstractOnly` flag (`abstract` when abstract-only, else `full_text`).
  Additive; the existing full-text-vs-abstract detection and `ABSTRACT_ONLY_GUARD`
  are unchanged.
- `packages/orchestrator/src/index.ts` — `handleDigest` branches on the Digest's
  `source_kind`: defer (re-enqueue with backoff for re-digest) or, at the deferral
  budget, flag-and-publish; re-digest from full text on retry when it has rendered.
  Reuses the existing queue/requeue idiom and the resume-from-stage guard.
- Consumes (merged): `digestor.run`, `orchestrator.handleDigest`,
  `orchestrator.dispatch`, `orchestrator.enqueueDiscovery`. Depends on PL-030
  (abstract-only detection + guard, merged).
