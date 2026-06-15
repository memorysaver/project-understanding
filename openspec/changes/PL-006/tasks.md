## 1. publisher module

- [x] 1.1 Create `packages/publisher` (package.json, tsconfig, exports) following
      the monorepo's `@paperlens/*` package conventions, consuming `@paperlens/db`.
- [x] 1.2 Implement `publish(db, args)` that, from a styled body, assembles and
      persists a `Post` with `status = "published"` — title, sanitized body,
      citation, and a link to the source paper — and returns the persisted Post.
- [x] 1.3 Build the citation from the source Paper's metadata (authors, title,
      arXiv id, source link).
- [x] 1.4 Sanitize the styled body before storage: strip `<script>`/`<style>`/
      `<iframe>` and similar elements, drop `on*` event-handler attributes, and
      neutralize `javascript:`/`data:` URLs.
- [x] 1.5 Advance the source Paper to `status = "published"` and stamp the Post's
      `published_at`, in one transaction so the Post and Paper never diverge. Set no
      tags (Layer 0).

## 2. Verification

- [x] 2.1 Unit test: `sanitizeBody` strips script-bearing elements, event-handler
      attributes, and `javascript:` URLs while keeping safe formatting and text.
- [x] 2.2 Unit test: `buildCitation` includes authors, title, arXiv id, and the
      source link.
- [x] 2.3 Integration test (in-memory db): a styled body yields a published Post
      with every field populated (title, body, citation, source link) and no tags.
- [x] 2.4 Integration test: the Post has `status = "published"` and a non-null
      `published_at`; the source Paper advances to `published`.
- [x] 2.5 Integration test: unsafe markup in the styled body is absent from the
      persisted, renderable body.
