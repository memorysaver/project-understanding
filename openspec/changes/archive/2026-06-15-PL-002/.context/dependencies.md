# Dependencies — PL-002

PL-002 has **no upstream story dependencies** (Layer 0, Wave 1, `shared_enabler`).
It is independent of PL-001 (different modules: `llm`/`env` vs `db`) — no file
conflicts.

Consumes/extends existing scaffolding:
- `packages/env/src/server.ts` — add OpenRouter base URL/key + per-stage model env
  vars (follow the existing env-schema validation pattern).
- New `packages/llm` — follow the `@paperlens/*` package layout (see another
  package such as `packages/api` or `packages/db` for package.json/tsconfig/exports
  conventions).

**Downstream consumers:** digestor (PL-004), stylist (PL-005) — call `llm.complete`.
