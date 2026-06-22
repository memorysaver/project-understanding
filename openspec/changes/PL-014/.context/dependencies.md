# Dependencies — PL-014

**Upstream story:** PL-001 (persistence) — **merged**. D1 + Drizzle schema is in
place and the Better Auth tables (scaffolded) are present and untouched. Session
lookup uses Better Auth's own adapter/tables — no new auth schema needed.

It consumes the existing scaffolded packages:
- `packages/auth/src/index.ts` — the Better Auth instance. Add a session
  resolver (request → owner session | null) here; do not change the schema.
- `packages/api/src/context.ts` — oRPC context creation. Attach the resolved
  session to the context; define the auth-gated procedure here.
- `packages/api/src/routers/**` — reader routers stay on the public procedure;
  console routers will compose on the new auth-gated procedure.

**Interface contract (web → api):** console procedures are auth-gated and return
`401` ("Unauthorized console call") with no session; `listPosts` / `getPost` are
public.

**Downstream consumers:** PL-015 (getActivePrompt / updateActivePrompt) and the
remaining console mutations (triggerRun, setPostStatus, previewRewrite) all build
on the auth-gated procedure from this story.
