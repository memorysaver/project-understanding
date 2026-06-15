## Why

After the crawler discovers a Paper, it sits at status `discovered` with only an
abstract. PaperLens digests the **full** paper text (not abstract-only) into a
structured form the stylist and publisher can rewrite faithfully. This is story
PL-004 — the `digestor` pipeline stage. It consumes the `llm-gateway`
(`complete`, PL-002) and the `persistence` layer (Paper/Digest, PL-001), so it is
a Layer 0 stage that unblocks the stylist (PL-005).

## What Changes

- Add a `packages/digestor` module exposing `run({ paperId, db, fetchFullText?, complete? })`.
- Fetch the full text for the Paper — prefer the arXiv HTML source, fall back to
  the stored abstract. The full-text fetcher is **injected** so tests use a
  fixture and never touch the network. Full-PDF binary parsing is out of scope.
- Call `llm.complete` with `stage: "digest"` and a Zod `schema` to get a
  structured Digest (`contributions`, `methods`, `results`).
- Persist the Digest linked to the Paper and advance the Paper to status
  `digested` — both in a single transaction.
- On LLM failure, rethrow the (retryable) error and leave the Paper at
  `discovered`: no Digest is written and the status is not advanced.

## Capabilities

### New Capabilities
- `digestor`: the digestor pipeline stage — turns a discovered Paper's full text
  into a persisted, structured Digest via the LLM and advances the Paper's status.

### Modified Capabilities
<!-- none -->

## Impact

- `packages/digestor` — new module (`run()`, `digestSchema`, `fetchArxivFullText`),
  with unit + contract + integration tests (mocked llm, fixture full text,
  in-memory bun:sqlite db).
- Consumes `@paperlens/llm` (`complete`) and `@paperlens/db` (papers/digests
  schema). No env, API, or UI changes in this story.
- Downstream: unblocks PL-005 (stylist), which reads the persisted Digest.
