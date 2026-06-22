# auth Specification

## Purpose
TBD - created by archiving change PL-014. Update Purpose after archive.
## Requirements
### Requirement: Console procedures require an authenticated owner session
The system SHALL require an authenticated owner session for every console
(curation) oRPC procedure, and SHALL reject an unauthenticated call with a `401`
(UNAUTHORIZED) error without reading or mutating any console state.

#### Scenario: Unauthenticated console call returns 401
- **WHEN** a console procedure is called without a valid owner session
- **THEN** the call fails with a `401` (UNAUTHORIZED) error and no console state
  is read or mutated

#### Scenario: Authenticated owner reaches the console
- **WHEN** an owner with a valid session calls a console procedure
- **THEN** the call is authorized and proceeds

### Requirement: Reader surface stays public
The system SHALL NOT require authentication for reader procedures; the gate
applies only to console procedures.

#### Scenario: Public reader query without a session
- **WHEN** `listPosts` or `getPost` is called without any session
- **THEN** the call succeeds and returns published content

