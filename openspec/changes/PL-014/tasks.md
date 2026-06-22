## 1. Session in the request context

- [ ] 1.1 In `packages/auth/src/index.ts`, export a session resolver over the
  existing Better Auth instance that returns the owner session (or null) for an
  incoming request. Do not modify the auth tables/schema.
- [ ] 1.2 In `packages/api/src/context.ts`, resolve the session during oRPC
  context creation and attach it to the context (e.g. `ctx.session`).

## 2. Auth-gated procedure

- [ ] 2.1 Add an auth-gated oRPC procedure/middleware in `packages/api` that
  throws a `401` (UNAUTHORIZED) when `ctx.session` is absent.
- [ ] 2.2 Keep reader procedures (`listPosts`, `getPost`) on the public/base
  procedure — leave them unauthenticated.

## 3. Verification

- [ ] 3.1 Unit test: calling a console (auth-gated) procedure without a session
  returns `401`.
- [ ] 3.2 Integration test: an owner with a valid session reaches a console
  procedure.
- [ ] 3.3 Confirm unauthenticated reader queries (`listPosts` / `getPost`) still
  succeed.

## Notes

- Cross-subdomain cookie config is a deploy-time open question — out of scope for
  this build; use the framework default cookie config.
