# Retrieval Instructions — PL-014

## Files to read first
- `packages/api/src/context.ts` (oRPC context creation — where the session attaches)
- `packages/api/src/index.ts` (how procedures/routers are defined and exported)
- `packages/auth/src/index.ts` (the Better Auth instance)
- `packages/api/src/routers/` (existing reader routers — match their procedure style)

## Patterns to explore
- How oRPC base procedures / middleware are defined in this project — match it for
  the auth-gated procedure.
- How Better Auth exposes the session for a request on Cloudflare Workers
  (headers / cookies); use the project's existing wiring rather than inventing one.
- How errors are surfaced over oRPC, so the gate returns a `401` consistent with
  the `web → api` contract.

## Do not read
- Other module internals (crawler/digestor/stylist/publisher/orchestrator) — not
  relevant to the auth gate.
- Better Auth table/schema definitions — they are untouched by this story.
