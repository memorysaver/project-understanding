# Retrieval Instructions — PL-001

## Files to read first
- `packages/db/src/index.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/schema/auth.ts` (for the existing Drizzle style/conventions)
- `packages/db/drizzle.config.ts`
- `docs/technical-spec.md` (§2 domain model, §3 Paper state machine)

## Patterns to explore
- How the existing auth schema defines tables (column helpers, exports) — match it.
- The project's migration generation command (drizzle-kit; check `package.json`
  scripts and `drizzle.config.ts`).

## Do not read
- Other packages' internals (api/web/auth logic) — not needed for the schema.
