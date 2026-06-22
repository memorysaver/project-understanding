## ADDED Requirements

### Requirement: Read the active style prompt (auth-gated)
The system SHALL provide an auth-gated `getActivePrompt` oRPC procedure that
returns the single active StylePrompt (its id and content). An unauthenticated
call SHALL fail with `401` and return no prompt data.

#### Scenario: Owner reads the active prompt
- **WHEN** an owner with a valid session calls `getActivePrompt`
- **THEN** the active StylePrompt's id and content are returned

#### Scenario: Unauthenticated read is rejected
- **WHEN** `getActivePrompt` is called without a valid owner session
- **THEN** the call fails with `401` and no prompt data is returned

### Requirement: Update the active style prompt, preserving exactly one active (auth-gated)
The system SHALL provide an auth-gated `updateActivePrompt` oRPC procedure that
persists new prompt content and SHALL maintain the invariant that exactly one
StylePrompt is active after the update. An unauthenticated call SHALL fail with
`401` and SHALL NOT mutate any prompt.

#### Scenario: Update persists content and keeps one active prompt
- **WHEN** an owner calls `updateActivePrompt` with new content
- **THEN** the new content is persisted and exactly one StylePrompt remains active

#### Scenario: Unauthenticated update is rejected
- **WHEN** `updateActivePrompt` is called without a valid owner session
- **THEN** the call fails with `401` and no prompt is created or modified
