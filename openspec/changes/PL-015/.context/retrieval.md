# Retrieval Instructions — PL-015

## Files to read first
- `packages/api/src/index.ts` (`protectedProcedure`, `publicProcedure`, app-router registration)
- `packages/api/src/routers/posts.ts` (reader router — mirror its procedure/router style)
- `packages/api/src/routers/auth.test.ts` (PL-014 test pattern: injected context, 401 assertions, handler-side sentinel)
- `packages/db/src/schema/*` (the `style_prompts` table) and `packages/db/src/seed.ts` (`seedDefaultStylePrompt`)
- `packages/db/src/paperlens.test.ts` (in-memory bun:sqlite + migration harness; single-active invariant test)

## Patterns to explore
- How an active StylePrompt is read/updated against `style_prompts` while keeping
  exactly one active (the PL-001 single-active invariant) — do the update in one
  transaction.
- The project's oRPC input validation (zod) for `updateActivePrompt` — recall the
  Zod v4 `.default({})` quirk (use `.optional()` + handler defaults).

## Do not read
- Reader-web / other module internals — not needed.
- Better Auth table/schema definitions — untouched by this story.
