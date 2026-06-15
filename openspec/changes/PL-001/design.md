## Context

PaperLens runs on Cloudflare Workers with Cloudflare D1 (SQLite) via Drizzle
(`drizzle-orm/d1`, bound as `DB`). The scaffolded `packages/db` currently holds
only the Better Auth schema. This change adds the PaperLens domain schema. See
`docs/technical-spec.md` §2 (domain model) and the `architecture.domain_model`
section of `product-context.yaml`.

## Goals / Non-Goals

**Goals:**
- A typed Drizzle schema + D1 migrations for Paper, Digest, StylePrompt, Post, Run.
- Encode dedup (arxiv_id UNIQUE), the Paper state machine, single-active prompt,
  and the published-post invariant.
- A seed for one default StylePrompt.

**Non-Goals:**
- No crawler/digestor/stylist/publisher logic (separate stories).
- No queue, no API, no UI.
- No R2 / large-blob storage decision (deferred; full text may live in D1 text
  columns for now).

## Decisions

- **D1, not Turso/LibSQL** — matches the scaffold (`drizzle-orm/d1`, `driver:
  d1-http`). The `@libsql` deps are vestigial.
- **`arxiv_id` as PRIMARY KEY (or UNIQUE)** on `papers` — dedup is enforced at the
  storage layer via `INSERT ... ON CONFLICT DO NOTHING`.
- **Status as a text enum column** with a default of `discovered` — SQLite has no
  native enum; enforce allowed values in the Drizzle column type / app layer.
- **Per-stage intermediates persisted** — `digests` and the styled body live in
  their own rows/columns keyed by paper, so retries are idempotent (tech-spec §2).
- **Single active StylePrompt** — `is_active` boolean; updating the active prompt
  is a transactional flip. Seed one default.

## Risks / Trade-offs

- D1 is single-writer; fine for Layer 0 (one paper, no queue). Concurrency is a
  Layer-1 concern (queue + state machine, PL-018).
- Storing full text in D1 text columns may hit row-size limits for large papers —
  acceptable for the skeleton; revisit with R2 if it bites (open question).
