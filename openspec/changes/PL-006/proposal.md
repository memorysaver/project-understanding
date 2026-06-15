## Why

The pipeline ends at the publisher: once the stylist has rewritten a Digest into
the owner's voice, that styled body must become a reader-facing `Post`. Without
this stage the styled text never reaches the blog and the source Paper is stuck
at `styled`. This is story PL-006 — the publisher that assembles and persists a
published Post (title, body, citation, link) and advances the Paper to
`published`.

## What Changes

- Add a `packages/publisher` module exposing `publish(db, args)` that, from a
  styled body, assembles and persists a `Post` with `status = "published"`.
- The Post carries `title`, a sanitized `body`, a `citation` built from the
  source Paper's metadata, and a link back to the source paper (carried in the
  citation). No tags are set at Layer 0.
- **Sanitize** the LLM-produced styled body before storing it as the renderable
  body — strip `<script>`/`<style>`/`<iframe>` and similar elements, drop `on*`
  event-handler attributes, and neutralize `javascript:`/`data:` URLs.
- Advance the source Paper to `status = "published"` and stamp the Post's
  `published_at`, in one transaction so the two never diverge.

## Capabilities

### New Capabilities

- `publisher`: the publisher stage of the PaperLens pipeline — assembles a
  styled body into a published `Post` (title, sanitized body, citation, source
  link), advances the source Paper to `published`, and sets `published_at`.

### Modified Capabilities

<!-- none -->

## Impact

- `packages/publisher` — new module (`publish()`), with unit + integration tests
  against an in-memory SQLite db.
- Consumes `@paperlens/db` schema and accessors (Paper, Post); no schema change.
- Downstream: the orchestrator (Layer 1) calls `publish` as the final pipeline
  stage; the reading surface renders the resulting published Posts.
- No env/API/UI changes in this story.
