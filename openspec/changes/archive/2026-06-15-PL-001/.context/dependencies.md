# Dependencies — PL-001

PL-001 has **no upstream story dependencies** (Layer 0, Wave 1, `shared_enabler`).

It consumes the existing scaffolded `packages/db`:
- `packages/db/src/index.ts` — `createDb()` returns `drizzle(env.DB, { schema })`
  using `drizzle-orm/d1`.
- `packages/db/src/schema/index.ts` — currently exports the Better Auth schema
  (`auth.ts`). Add PaperLens tables alongside; do not modify auth.
- `packages/db/drizzle.config.ts` — `driver: "d1-http"`.
- `packages/env/src/server.ts` — `env.DB` binding.

**Downstream consumers** (will import these tables): crawler (PL-003), digestor
(PL-004), stylist (PL-005), publisher (PL-006), reader API (PL-008).
