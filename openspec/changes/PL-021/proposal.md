## Why

Posts auto-publish through the pipeline, but the owner has no way to take a bad
post back down or fix its body. PL-021 completes the auto-publish +
owner-can-unpublish/edit decision — the safety net for a bad post — by adding the
auth-gated console procedure that toggles a post's status (and edits its body).
The auth gate (PL-014), the published-only reader feed (PL-008), and the post
persistence (PL-006) are all merged; this is the console mutation that builds on
them. `protectedProcedure` already names `setPostStatus` as an expected console
procedure.

## What Changes

- Add `api.setPostStatus` — an **auth-gated** oRPC procedure that lets the owner
  toggle a post between `published` and `unpublished` (and optionally edit its
  `body`). Composes on `protectedProcedure` (PL-014), so an unauthenticated call
  returns `401` and never reads or mutates the post.
- Moving a post to `unpublished` removes it from the public feed; moving it back
  to `published` restores it. The reader feed (`listPosts`/`getPost`, PL-008)
  already filters on `status = "published"`, so this requirement is satisfied by
  the status flip alone — no reader-side change.
- A published post must keep its non-null `published_at` invariant; republishing
  an unpublished post sets `published_at` when it is missing.

## Capabilities

### Modified Capabilities
- `console-api`: extend the auth-gated console surface with `setPostStatus` —
  the owner's unpublish/republish/edit-body activity for a post — alongside the
  existing prompt procedures.

## Impact

- `packages/api/src/routers/posts.ts` — add `setPostStatus` on
  `protectedProcedure`; reads/writes `posts` via the db. The existing reader
  procedures (`listPosts`, `getPost`) stay on `publicProcedure`, unchanged.
- `packages/api/src/routers/index.ts` — register `setPostStatus` in the app
  router (additive; existing `AppRouter` members unchanged).
- `apps/web/src/routes/console/posts.tsx` — console post controls that call
  `setPostStatus` (web; minimal wiring for the owner to unpublish/republish).
- Consumes the PL-006 `posts` table, the PL-008 published-only feed filter, and
  the PL-014 `protectedProcedure`. No D1 schema change.
- Downstream: backs the console post-management UI and the
  owner-can-unpublish/edit safety net.
