## Context

PaperLens runs on Cloudflare Workers; the API is oRPC over HTTP (`web → api`),
auth is Better Auth, persistence is Cloudflare D1 via Drizzle. At Layer 1 the
console (curation) surface comes online and must be owner-only, while the reader
surface stays public. Better Auth is already scaffolded (`packages/auth`,
`packages/api/src/context.ts` exists); this change connects it to the oRPC
context and enforces the gate. See the `auth` module and the `web → api`
interface in `product-context.yaml`.

## Goals / Non-Goals

**Goals:**
- Resolve the owner session per request and attach it to the oRPC context.
- An auth-gated oRPC procedure that returns `401` when no owner session is
  present; console routers build on it.
- Keep reader procedures public.

**Non-Goals:**
- No console UI (sign-in page polish, prompt editor) — that is web-side / later
  stories.
- No new console procedures (getActivePrompt/updateActivePrompt are PL-015).
- No changes to the Better Auth schema/tables.
- No cross-subdomain cookie work (deploy-time; see Decisions).

## Interface contract (web → api)

- Console procedures (getActivePrompt, updateActivePrompt, triggerRun,
  setPostStatus, previewRewrite) are **auth-gated**.
- Error `401` — "Unauthorized console call" — when no owner session.
- Reader procedures (`listPosts`, `getPost`) are **public**.

## Decisions

- **Session resolution lives in the api context** — `context.ts` reads the
  request headers, asks Better Auth for the session, and attaches it (e.g.
  `ctx.session`). One place, every procedure sees it.
- **Gate via a procedure/middleware, not per-handler checks** — define an
  auth-gated oRPC procedure once; console routers compose on it. This is the
  reusable enabler PL-015+ consume, and it keeps the 401 behavior in one spot.
- **401 as the oRPC error** — match the declared `web → api` contract
  (`code: 401`, "Unauthorized console call"). Reader procedures never go through
  the gate.
- **Default cookie config for the build** — cross-subdomain cookies are a
  deploy concern (`auth.key_concepts` lists it as an open question); use the
  framework default same-origin config now.

## Dependency APIs (consumed)

- **PL-001 persistence (merged):** D1 + Drizzle; Better Auth tables present and
  untouched. Session lookup uses Better Auth's own adapter/tables.
- **Existing scaffold:** `packages/auth/src/index.ts` (Better Auth instance),
  `packages/api/src/context.ts` (oRPC context creation).

## Risks / Trade-offs

- Cross-subdomain auth may need cookie/domain config at deploy; deferring it
  keeps this story buildable now and isolates the deploy decision (open
  question, revisit when the console gets its own subdomain).
- The gate must fail closed: a missing/invalid session must 401, never fall
  through to an authorized path. Covered by the unit test.
