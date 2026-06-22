## Why

The console (curation surface) has no authentication yet. PL-014 is the Layer 1
prerequisite that gates every console procedure behind an authenticated owner
session, while keeping the reader surface (feed + article) fully public. Without
it, the console mutations that follow — PL-015 (getActivePrompt /
updateActivePrompt), triggerRun, setPostStatus, previewRewrite — would be
world-writable. Better Auth is already scaffolded in `packages/auth`; this story
wires it into the oRPC request context and enforces the gate.

## What Changes

- Resolve the owner session from the incoming request in the oRPC context
  (`packages/api/src/context.ts`), using the already-scaffolded Better Auth
  instance in `packages/auth`.
- Add an **auth-gated oRPC procedure** that console routers build on: it returns
  `401` (UNAUTHORIZED) when there is no owner session.
- Reader queries (`listPosts`, `getPost`) stay on the public/base procedure —
  unauthenticated access is unchanged.
- An owner who is signed in reaches the console.
- Better Auth tables (created by the scaffold, left untouched by PL-001) are not
  modified.

## Capabilities

### New Capabilities
- `auth`: an owner-session check that gates the console (curation) surface; the
  public reader surface is unaffected.

## Impact

- `packages/auth/src/index.ts` — expose session resolution from a request (a thin
  helper over the existing Better Auth instance). Auth schema untouched.
- `packages/api/src/context.ts` — populate the session on the oRPC context and
  provide the auth-gated procedure builder used by console routers.
- Downstream: unblocks PL-015 and the remaining console mutations — all reuse the
  auth-gated procedure from this story.
- No reader-side query or UI logic changes beyond resolving the session.

### Deferred
- **Cross-subdomain cookie configuration** (console vs reader subdomains) is a
  deploy-time open question — out of scope for this build. Use the framework
  default cookie config; revisit at deploy.
