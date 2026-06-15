## 1. Request context

- [x] 1.1 Add a Drizzle `db` handle to the api request context
  (`packages/api/src/context.ts`), typed broadly over the SQLite dialect so the
  prod D1 database and an in-memory bun:sqlite test database both satisfy it. The
  prod `createContext` builds it via `createDb()`.

## 2. Reader procedures

- [x] 2.1 Create `packages/api/src/routers/posts.ts` with a public `listPosts`
  procedure: input `{ limit?, offset? }` (default limit 20, max 100, offset >= 0);
  query only `status = "published"`, order by `published_at` descending, apply
  limit/offset; return the items plus the effective `limit` and `offset`.
- [x] 2.2 Add a public `getPost` procedure: input `{ id }`; return the post only
  when `status = "published"`, otherwise throw `ORPCError("NOT_FOUND")` so
  unpublished, draft, and missing collapse to the same not-found response.
- [x] 2.3 Register `listPosts` and `getPost` on the app router in
  `packages/api/src/routers/index.ts` as `api.listPosts` / `api.getPost`.

## 3. Verification

- [x] 3.1 Add `packages/api/src/routers/posts.test.ts` building an in-memory
  SQLite database (D1 migration applied) seeded with published, unpublished, and
  draft posts, and invoking the procedures via oRPC `call`.
- [x] 3.2 Unit: assert `listPosts` excludes unpublished/draft, orders newest first,
  and paginates with limit/offset.
- [x] 3.3 Unit: assert `getPost` returns a published post and throws `NOT_FOUND`
  for unpublished, draft, and missing ids.
- [x] 3.4 Contract: assert the `listPosts` response shape and that invalid
  pagination / empty id inputs are rejected by the procedure schema.
- [x] 3.5 `bun test` green and `bun run check-types` clean.
