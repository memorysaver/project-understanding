## ADDED Requirements

### Requirement: Trigger a discovery run on demand (auth-gated)
The system SHALL provide an auth-gated `triggerRun` oRPC procedure that enqueues a
discovery run and returns its `runId`. Invoking it SHALL create a `Run` row (with
`trigger = "manual"`) and SHALL enqueue a `discover` pipeline message carrying that
run's id, by delegating to the orchestrator's `enqueueDiscovery`. The procedure
SHALL compose on `protectedProcedure`: an unauthenticated call SHALL fail with
`401`, and SHALL NOT enqueue any message or create a `Run` row. A console control
SHALL invoke `triggerRun`; the public reader surface SHALL NOT be able to trigger a
run.

#### Scenario: Owner triggers a run and it is enqueued
- **WHEN** an owner with a valid session calls `triggerRun`
- **THEN** a `Run` row is created (`trigger = "manual"`), a `discover` pipeline
  message carrying that run's id is enqueued, and the call returns the `runId`

#### Scenario: Unauthenticated trigger is rejected
- **WHEN** `triggerRun` is called without a valid owner session
- **THEN** the call fails with `401` and no `Run` row is created and no message is
  enqueued
