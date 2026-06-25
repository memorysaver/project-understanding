## 1. setPostStatus procedure

- [ ] 1.1 Add `setPostStatus` to `packages/api/src/routers/posts.ts` on
  `protectedProcedure` (PL-014). Input: `id` (required), `status`
  (`published` | `unpublished` enum), optional `body`. Validate with the
  project's zod pattern (remember the Zod v4 `.default({})` quirk — prefer
  `.optional()` + handler defaults).
- [ ] 1.2 Toggle status in place via the existing posts accessor —
  `ctx.db.update(posts).set({ status, ...body? }).where(eq(posts.id, input.id))`.
  When republishing a post whose `published_at` is null, set `published_at` in
  the same update so the PL-006 invariant (a `published` post has a non-null
  `published_at`) holds. Throw `NOT_FOUND` for a missing id.

## 2. Wire into the app router

- [ ] 2.1 Register `setPostStatus` in `packages/api/src/routers/index.ts`
  alongside the existing `posts` reader procedures. Leave `listPosts`/`getPost`
  on `publicProcedure` and the existing `AppRouter` members unchanged.

## 3. Console wiring (web)

- [ ] 3.1 In `apps/web/src/routes/console/posts.tsx`, add the owner controls that
  call `setPostStatus` to unpublish / republish a post (minimal wiring; reuses
  the auth-gated client).

## 4. Verification

- [ ] 4.1 Unit test (status toggle): `setPostStatus` flips a post from
  `published` to `unpublished` and back; after each call the post's `status` is
  the requested value and a republished post has a non-null `published_at`. Use
  the in-memory bun:sqlite + `0000_keen_supernaut.sql` migration harness; inject
  the context (db + session), never call the prod `createContext`.
- [ ] 4.2 Unit test (auth required): `setPostStatus` called without a session
  returns `401` (`ORPCError("UNAUTHORIZED")`) and does not read/mutate the post
  (handler-side sentinel, per the PL-014 pattern).
- [ ] 4.3 Integration test (unpublished hidden from feed): after
  `setPostStatus(id, "unpublished")`, the post no longer appears in `listPosts`
  and `getPost(id)` returns `NOT_FOUND`; after republishing, it reappears in
  `listPosts`. Drive through the real reader procedures (PL-008) on the shared
  db harness.
- [ ] 4.4 `bun run check-types` passes repo-wide.
