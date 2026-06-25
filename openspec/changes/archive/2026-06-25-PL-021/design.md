## Context

The console is auth-gated via `protectedProcedure = publicProcedure.use(requireAuth)`
(PL-014, in `packages/api/src/index.ts`; fail-closed 401). Persistence (PL-006)
defines `posts (id, ..., status, published_at, ...)` with the post lifecycle enum
`["draft", "unpublished", "published"]` and the invariant that a `published` post
has a non-null `published_at`. The reader feed (PL-008) — `listPosts`/`getPost` in
`packages/api/src/routers/posts.ts` — constrains every query to
`status = "published"`, so unpublished/draft posts never appear in the public
feed. PL-021 exposes the owner's unpublish/republish (and body edit) of a post as
an auth-gated oRPC procedure. See the `web → api` interface in
`product-context.yaml` (console mutations are auth-gated).

## Goals / Non-Goals

**Goals:**
- `setPostStatus` on `protectedProcedure`, toggling a post between `published`
  and `unpublished` (and optionally editing its `body`).
- A flip to `unpublished` removes the post from the public feed; a flip back to
  `published` restores it, preserving the non-null `published_at` invariant.

**Non-Goals:**
- No reader-side change (the published-only filter already hides unpublished
  posts; PL-008).
- No new lifecycle states (draft is owned by the pipeline, not the console).
- No bulk operations, no post deletion, no D1 schema change.

## Decisions

- **Compose on `protectedProcedure`** — `setPostStatus` inherits the PL-014 gate,
  so the 401 behavior and owner-session check live in one place (do not
  re-implement auth per procedure). Mirror the `prompt.ts` console router
  structure (PL-015).
- **Toggle via the existing `posts` accessor** — update the target row's `status`
  (and `body` when supplied) in place via `ctx.db.update(posts)...where(eq(posts.id, id))`.
  Accept only `published` / `unpublished` in the input (zod enum); do not let the
  console set `draft`. Return the updated post (or its id + new status).
- **Preserve the published_at invariant** — when republishing a post whose
  `published_at` is null, set `published_at` in the same update so the PL-006
  invariant (a `published` post has a non-null `published_at`) holds. Unpublishing
  leaves `published_at` as-is.
- **No reader change** — the feed already filters on `status = "published"`
  (PL-008), so an unpublished post disappears from `listPosts`/`getPost` with no
  further work. The integration test pins this end-to-end.
- **Input validation** — follow the project's zod pattern (and the Zod v4
  `.default({})` quirk: prefer `.optional()` + handler defaults). `id` required;
  `status` is the `published`/`unpublished` enum; `body` optional.

## Dependency APIs (consumed)

- **PL-006 persistence (merged):** `posts` table + post lifecycle enum +
  published_at invariant. Read/update posts via the db (`drizzle-orm/d1`); tests
  use the in-memory bun:sqlite + `0000_keen_supernaut.sql` migration harness.
- **PL-008 reader feed (merged):** `listPosts`/`getPost` constrain to
  `status = "published"`; the integration test reuses this to prove an
  unpublished post is hidden from the feed.
- **PL-014 auth (merged):** `protectedProcedure` in `packages/api/src/index.ts`.
- The oRPC context already carries `db` and `session` (PL-008 + PL-014).

## Risks / Trade-offs

- A `setPostStatus` on a missing id should fail cleanly (`NOT_FOUND`) rather than
  silently no-op; pinned by a unit test. D1 is single-writer, so the status flip
  is not contended at this layer.
