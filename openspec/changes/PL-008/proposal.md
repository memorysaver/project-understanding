## Why

PaperLens publishes styled posts, but readers have no public way to read them. The
reader-facing surface needs two public, unauthenticated oRPC procedures: list the
published posts (newest first, paginated) and fetch a single published post by id.
The hard constraint is a no-leak invariant — draft and unpublished posts must never
be observable through either procedure, including the difference between "exists but
hidden" and "does not exist". This is story PL-008 — the public Reader API.

## What Changes

- Add `packages/api/src/routers/posts.ts` with two public oRPC procedures:
  - `listPosts({ limit?, offset? })` — returns only `status = "published"` posts,
    ordered by `published_at` descending (newest first), with limit/offset
    pagination (default limit 20, max 100).
  - `getPost({ id })` — returns a published post by id, or a `NOT_FOUND` error for
    any unpublished, draft, or missing post (the three are indistinguishable).
- Register both procedures on the app router in
  `packages/api/src/routers/index.ts` as `api.listPosts` and `api.getPost`.
- Wire a Drizzle `db` handle onto the api request context
  (`packages/api/src/context.ts`) so procedures query the database; the prod
  context uses the D1 database, tests inject an in-memory SQLite database.

## Capabilities

### New Capabilities
- `reader-api`: the public, unauthenticated read surface for published posts —
  list (paginated, newest first) and fetch-by-id, with a strict no-leak guarantee
  that draft/unpublished content is never returned or disclosed.

### Modified Capabilities
<!-- none -->

## Impact

- `packages/api/src/routers/posts.ts` — new procedures (`listPosts`, `getPost`).
- `packages/api/src/routers/index.ts` — register the two procedures.
- `packages/api/src/context.ts` — add `db` to the request context.
- Tests: `packages/api/src/routers/posts.test.ts` — unit + contract tests over an
  in-memory SQLite database seeded with published, unpublished, and draft posts.
- No auth, DB schema, or UI changes in this story. These are public procedures —
  no authentication is applied.
