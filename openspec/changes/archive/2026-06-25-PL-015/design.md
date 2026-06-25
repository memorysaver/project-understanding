## Context

The console is auth-gated via `protectedProcedure = publicProcedure.use(requireAuth)`
(PL-014, in `packages/api/src/index.ts`; fail-closed 401). Persistence (PL-001)
defines `style_prompts (id, content, is_active, created_at, updated_at)` with the
**single-active invariant** (exactly one `is_active = true`) and seeds one default
(`seedDefaultStylePrompt`). PL-015 exposes the owner's read/update of that active
prompt as auth-gated oRPC procedures. See the `web → api` interface in
`product-context.yaml` (console mutations are auth-gated).

## Goals / Non-Goals

**Goals:**
- `getActivePrompt` / `updateActivePrompt` on `protectedProcedure`.
- `updateActivePrompt` persists new content and preserves exactly one active
  prompt (transactional flip).

**Non-Goals:**
- No console UI / prompt-editor page (web, later).
- No prompt history/versioning UI, no multi-prompt management (single active
  prompt only).
- No reader-side changes; no D1 schema change.

## Decisions

- **Compose on `protectedProcedure`** — both procedures inherit the PL-014 gate,
  so the 401 behavior and owner-session check live in one place (do not re-implement
  auth per procedure).
- **Single active prompt, updated transactionally** — `updateActivePrompt` either
  updates the existing active row's content in place, or (if creating a new prompt
  row) flips active in the same transaction so the invariant "exactly one active"
  is never violated mid-update. Reuse the PL-001 invariant; do not add a second
  active row.
- **New `prompt` router** — mirror the existing `posts` router structure; register
  it in the app router. Reader (`posts`) procedures stay on `publicProcedure`.

## Dependency APIs (consumed)

- **PL-001 persistence (merged):** `style_prompts` table + single-active invariant
  + `seedDefaultStylePrompt`. Read the active prompt and update it via the db
  (`drizzle-orm/d1`); tests use the in-memory bun:sqlite + PL-001 migration harness.
- **PL-014 auth (merged):** `protectedProcedure` in `packages/api/src/index.ts`.
- The oRPC context already carries `db` and `session` (PL-008 + PL-014).

## Risks / Trade-offs

- The transactional flip must hold the single-active invariant under a malformed
  or empty update; pinned by the unit test. D1 is single-writer, so the flip is
  not contended at this layer.
