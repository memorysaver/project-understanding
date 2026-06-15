# Retrieval Instructions — PL-002

## Files to read first
- `packages/env/src/server.ts` (env schema pattern)
- `packages/api/package.json` and `packages/db/package.json` (package conventions)
- `docs/technical-spec.md` §1 (llm module), §4.4 (digestor/stylist → llm)

## Patterns to explore
- How existing `@paperlens/*` packages declare exports, tsconfig, and deps.
- The env validation/schema approach already used in `packages/env`.

## Do not read
- digestor/stylist/db internals — not needed; this is the LLM boundary only.
