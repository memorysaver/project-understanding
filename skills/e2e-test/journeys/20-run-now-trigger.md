---
target: web
layer: 1
covers: [PL-020-ac1, PL-020-ac2] # triggerRun enqueues+creates a Run; console-only / reader cannot
---

# Journey 20 — Manual "run now" trigger (auth-gated)

**Story:** As the owner, I want to trigger a discovery run on demand from the console, so that I can ingest
new papers without waiting for the (Layer-2) scheduler.

**Covers:** PL-020 (Layer 1) — the auth-gated `triggerRun` procedure + the console "Run now" button. Key
endpoints/tools: `POST /rpc/triggerRun` (oRPC, auth-gated), the orchestrator's `enqueueDiscovery("manual")`,
the `runs` table, the pipeline `discover` queue message.

**Preconditions:** dev server running (started by `.claude/hooks/workspace-setup.sh`);
`.dev-workflow/ports.env` present; `scripts/seed.sh` has run (provides the owner test account for sign-in).

## Scenario 20.1 — Owner triggers a run and it is enqueued
- **Given** I am signed in as the owner and on the console "Run now" surface (`/console`)
- **When** I click the "Run now" button
- **Then** a run is started and its `runId` is shown
- **Verify (API/state):** the `triggerRun` call returns `{ runId: <string> }`; a new `runs` row exists with
  `trigger = "manual"` (and `status = "running"`); exactly one `{ type: "discover", runId }` message was
  enqueued to the pipeline carrying that same `runId`. (Re-fetch the run row / inspect the queue — not just
  the rendered runId text.)

## Scenario 20.2 — The reader surface cannot trigger a run (auth-gated)
- **Given** I am NOT signed in
- **When** I attempt to invoke `triggerRun` (and when I navigate to `/console`)
- **Then** the call is rejected and the console is not reachable
- **Verify (API/state):** an unauthenticated `POST /rpc/triggerRun` fails with `401` (UNAUTHORIZED); NO new
  `runs` row is created and NO `discover` message is enqueued; navigating to `/console` while unsigned
  redirects to `/login`. The public reader surface exposes no trigger control.

## Cleanup
Soft reset — re-run `scripts/seed.sh` to converge the fixture for the next journey. Manual runs against a
fixed seed are idempotent at the Paper level (PL-018), so a triggered run leaves no duplicate output.
