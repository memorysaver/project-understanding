## ADDED Requirements

### Requirement: Style a Digest into a post body
The system SHALL provide a stylist `run` function that, given a paper's `Digest`,
produces a non-empty styled post body via the LLM and returns it together with the
style prompt id, digest id, and model used.

#### Scenario: Digest becomes a non-empty styled body
- **WHEN** `run` is called for a paper that has a `Digest`
- **THEN** it returns a non-empty styled post body produced from that Digest

#### Scenario: An empty styled body is rejected
- **WHEN** the LLM returns an empty (or whitespace-only) styled body
- **THEN** `run` throws and the paper's status is left unchanged

### Requirement: Use the active StylePrompt as the voice
The system SHALL load the single active (`is_active = true`) `StylePrompt` and pass
its text as the system/style instruction to the LLM, and SHALL NOT hardcode the
prompt text.

#### Scenario: The active prompt drives the styling
- **WHEN** `run` styles a Digest
- **THEN** the system/style message sent to the LLM is the content of the active
  StylePrompt

#### Scenario: A flipped active prompt is honored
- **WHEN** the active StylePrompt is changed before `run` is called
- **THEN** `run` uses the currently active prompt's content, not the previously
  seeded default

### Requirement: Advance the Paper to styled
The system SHALL advance the `Paper` to status `styled` when styling succeeds.

#### Scenario: Status advances on success
- **WHEN** `run` successfully produces a styled body for a digested paper
- **THEN** the paper's status becomes `styled`

### Requirement: Inject the LLM for offline runs
The system SHALL accept the LLM `complete` function and the database handle as
injected dependencies so the stage can run without network access in tests.

#### Scenario: Runs against a mocked LLM
- **WHEN** `run` is invoked with a mocked `complete` and an in-memory database
- **THEN** it produces the styled body without making any network call
