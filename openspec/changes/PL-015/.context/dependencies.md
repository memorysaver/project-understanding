# Dependencies — PL-015

**Upstream stories (both merged):**
- **PL-001 (persistence):** `style_prompts` table — `sqliteTable("style_prompts",
  { id, content, is_active, created_at, updated_at })` in `packages/db` — with the
  **single-active invariant** (exactly one `is_active = true`) and
  `seedDefaultStylePrompt(db)` seeding one default. Read/update the active prompt
  through the db (`drizzle-orm/d1`); the standard test harness is in-memory
  `bun:sqlite` + the applied PL-001 migration (`packages/db/src/paperlens.test.ts`).
- **PL-014 (auth):** `protectedProcedure = publicProcedure.use(requireAuth)` in
  `packages/api/src/index.ts` — fail-closed, `401` "Unauthorized console call".
  Compose the two prompt procedures on it. The oRPC context already carries `db`
  (PL-008) and `session` (PL-014).

**Sibling pattern:** the existing reader router `packages/api/src/routers/posts.ts`
(on `publicProcedure`) shows the router/procedure style and how routers register
in `packages/api/src/index.ts` — mirror it for the new `prompt` router.

**Downstream consumers:** the console prompt-editor UI (web, later) calls these
procedures; PL-016+ console mutations follow the same auth-gated pattern.
