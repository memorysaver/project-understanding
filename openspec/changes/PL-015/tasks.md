## 1. Prompt router

- [ ] 1.1 Add `packages/api/src/routers/prompt.ts` with `getActivePrompt` on
  `protectedProcedure` — reads the single active `style_prompts` row from
  `ctx.db` and returns `{ id, content }`.
- [ ] 1.2 Add `updateActivePrompt` on `protectedProcedure` — accepts new content
  (validate with the project's zod pattern; remember the Zod v4 `.default({})`
  quirk — prefer `.optional()` + handler defaults), persists it, and keeps
  exactly one active StylePrompt via a single transaction (update the active row
  in place, or flip active atomically if inserting a new row).

## 2. Wire into the app router

- [ ] 2.1 Register the `prompt` router in `packages/api/src/index.ts` alongside
  the existing `posts` router. Leave reader procedures on `publicProcedure` and
  the existing `AppRouter` members unchanged.

## 3. Verification

- [ ] 3.1 Unit test (single-active invariant): after `updateActivePrompt`,
  exactly one `style_prompts` row has `is_active = true` and it holds the new
  content. Use the in-memory bun:sqlite + PL-001 migration harness; inject the
  context (db + session), never call the prod `createContext`.
- [ ] 3.2 Unit test (auth): `getActivePrompt` and `updateActivePrompt` called
  without a session both return `401` (`ORPCError("UNAUTHORIZED")`) and do not
  read/mutate prompt state (handler-side sentinel, per the PL-014 pattern).
- [ ] 3.3 Contract test (procedure shapes): the input/output shapes of
  `getActivePrompt` and `updateActivePrompt` match their declared contracts.
- [ ] 3.4 `bun run check-types` passes repo-wide.
