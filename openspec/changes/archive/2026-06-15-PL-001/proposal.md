## Why

PaperLens has no persistence layer yet. Every pipeline stage (crawler, digestor,
stylist, publisher, orchestrator) and both surfaces (reader feed, curation
console) read and write through a shared database. The walking skeleton (Layer 0)
cannot move a single paper from crawl → digest → style → publish without the
core tables and their invariants in place. This is story PL-001 — the
foundational `shared_enabler` for Layer 0 Wave 1.

## What Changes

- Add a Drizzle schema + Cloudflare D1 migrations for the core domain entities:
  `Paper`, `Digest`, `StylePrompt`, `Post`, `Run`.
- Encode the `Paper` status state machine
  (`discovered → digested → styled → published`, plus `failed`).
- Make `arxiv_id` the dedup key (UNIQUE) so the same paper is never stored twice.
- Enforce the single-active-`StylePrompt` invariant and seed one default prompt.
- Enforce the published-`Post` invariant (a published Post has `published_at`).
- Existing auth tables (Better Auth) are untouched.

## Capabilities

### New Capabilities
- `persistence`: the D1/Drizzle data model for PaperLens — entities, the Paper
  state machine, dedup, and core invariants that every pipeline stage and surface
  depends on.

### Modified Capabilities
<!-- none — this is the first persistence change -->

## Impact

- `packages/db` — new Drizzle schema files + D1 migrations (additive; auth schema
  unchanged).
- Downstream: unblocks PL-003 (crawler), PL-004 (digestor), PL-005 (stylist),
  PL-006 (publisher), PL-008 (reader API) — all consume these tables.
- No API or UI changes in this story.
