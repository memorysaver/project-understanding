## Why

The console (curation surface) is now auth-gated (PL-014) but has no procedures
yet. The owner's first console capability — the **define-voice** activity — is
editing the single active StylePrompt that the stylist uses to rewrite every
paper. PL-015 adds the two auth-gated oRPC procedures that back the console
prompt editor: read the active prompt and update it.

## What Changes

- Add `api.getActivePrompt` — an **auth-gated** oRPC procedure returning the
  single active StylePrompt (content + id).
- Add `api.updateActivePrompt` — an **auth-gated** oRPC procedure that persists
  new prompt content and keeps **exactly one** active StylePrompt (transactional
  active flip), reusing the single-active invariant established in PL-001.
- Both procedures compose on `protectedProcedure` (PL-014), so an
  unauthenticated call returns `401` and never reads or mutates prompt state.
- A new `packages/api/src/routers/prompt.ts` router, wired into the app router
  alongside the existing reader (`posts`) router.

## Capabilities

### New Capabilities
- `console-api`: the auth-gated console procedures for the active StylePrompt
  (`getActivePrompt`, `updateActivePrompt`), maintaining the single-active
  invariant on update.

## Impact

- `packages/api/src/routers/prompt.ts` — new router with the two procedures on
  `protectedProcedure`; reads/writes `style_prompts` via the db.
- `packages/api/src/index.ts` — register the `prompt` router in the app router
  (additive; reader routes and the `AppRouter` type's existing members
  unchanged).
- Consumes the PL-001 `style_prompts` table + single-active invariant and the
  PL-014 `protectedProcedure`. No D1 schema change.
- Downstream: backs the console prompt-editor UI (web, later) and the
  define-voice activity.
