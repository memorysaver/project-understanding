## 1. Feed page (PL-009)

- [x] 1.1 Implement `apps/web/src/routes/index.tsx` as the reader feed: call
  `api.listPosts` via the app's oRPC TanStack Query client (`orpc.listPosts`),
  rendering items in the returned newest-first order.
- [x] 1.2 Render each item as a TanStack Router `Link` to `/posts/$id`; render
  loading and empty states. No search or filter UI.

## 2. Article page (PL-010)

- [x] 2.1 Add `apps/web/src/routes/posts.$id.tsx` calling `api.getPost` with the
  route `id` param; render the post title and the sanitized body (sanitized at
  publish time by PL-006) as formatted content.
- [x] 2.2 Render a link back to the source paper (the arXiv entry for the post's
  `paperId`) and the citation line.
- [x] 2.3 Handle the `NOT_FOUND` error from `getPost` by rendering a not-found
  state for unknown or unpublished ids.

## 3. Verification

- [x] 3.1 `bun run check-types` clean repo-wide (this builds the web app, so both
  routes compile and the generated route tree regenerates to include `/posts/$id`).
- [x] 3.2 `bun test` green (no web test runner exists; correctness of the data
  wiring is proven by the build plus independent review).
- [x] 3.3 Confirm all four acceptance criteria: feed uses `listPosts` newest-first
  with article links; article uses `getPost` with title + body + source link and a
  not-found state.
