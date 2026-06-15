## Why

The pipeline needs a stylist stage that turns a paper's structured Digest into a
post body written in the owner's voice. The whole point of PaperLens is that the
feed reads like one thoughtful editor wrote it, not a generic summarizer — so the
styled body must come from the single active (default) StylePrompt that PL-001
seeds, not a hardcoded prompt. This is story PL-005; it consumes `llm.complete`
(PL-002) and the `Digest`/`StylePrompt` entities (PL-001), and unblocks the
publisher (PL-006).

## What Changes

- Add a `packages/stylist` module exposing `run({ db, complete }, { paperId })`
  that rewrites a paper's Digest into a styled post body.
- Load the single active (`is_active = true`) StylePrompt and pass its text as the
  system/style instruction to `complete({ stage: "style", ... })`.
- Load the paper's latest Digest and render its structured fields as the user
  message to be styled.
- Return the styled body (plus the style prompt id, digest id, and model used) and
  advance the Paper to status `styled` on success.
- Reject an empty styled body and leave the Paper status unchanged.
- Inject `db` and `complete` so the stage runs fully offline in tests (mocked
  llm, in-memory SQLite with the real D1 migration + seeded default prompt).

## Capabilities

### New Capabilities
- `stylist`: the stylist pipeline stage — rewrites a Digest into a styled post
  body using the active StylePrompt as the voice and advances the Paper to
  `styled`.

### Modified Capabilities
<!-- none -->

## Impact

- `packages/stylist` — new module (`run()`), with unit + integration + contract
  tests.
- Consumes `@paperlens/llm` (`complete`) and `@paperlens/db` (`StylePrompt`,
  `Digest`, `Paper`).
- Downstream: produces the styled body the publisher (PL-006) assembles into a
  Post.
- No DB schema, API, or UI changes in this story.
