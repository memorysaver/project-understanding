# orchestrator Specification

## Purpose
TBD - created by archiving change PL-007. Update Purpose after archive.
## Requirements
### Requirement: Inline single-paper run produces a published Post

The system SHALL provide a `runOnce` operation that, given an arXiv id, runs the
four pipeline stages inline and in order — crawler discovery, digestor, stylist,
publisher — threading the paper through the status machine (discovered → digested
→ styled → published), and SHALL return the resulting published `Post`.

#### Scenario: A hardcoded arXiv id yields a published Post

- **WHEN** `runOnce` is invoked for a hardcoded arXiv id
- **THEN** the paper is discovered, digested, styled, and published, and a `Post`
  with `status = "published"` for that paper is returned, with its source Paper
  advanced to `status = "published"`

### Requirement: Idempotent re-run adds no duplicate Paper or Post

The system SHALL make `runOnce` idempotent for a given arXiv id: a re-run SHALL
NOT create a duplicate Paper or a duplicate Post. When the paper already has a
published Post, `runOnce` SHALL return that existing Post without re-running the
stages.

#### Scenario: Re-running the pipeline creates no duplicates

- **WHEN** `runOnce` is invoked a second time for the same arXiv id after a
  published Post already exists
- **THEN** the same published Post is returned and no additional Paper, Digest, or
  Post row is created

### Requirement: Dependency-injected stages for offline testability

The system SHALL allow `runOnce` to receive injected dependencies — the database,
the llm `complete` client, the arXiv metadata fetcher, and the full-text fetcher —
so the whole pipeline can run offline against a mocked llm, fixture fetchers, and
an in-memory database, and SHALL default each dependency to the real client or
fetcher when not supplied.

#### Scenario: The pipeline runs end-to-end with mocked dependencies

- **WHEN** `runOnce` is invoked with an in-memory database, a fixture arXiv
  fetcher, a fixture full-text fetcher, and a mocked llm `complete`
- **THEN** the pipeline completes without any network access and produces a
  published Post

### Requirement: Dev-only server trigger

The system SHALL expose a development-only HTTP trigger in the server that invokes
`runOnce` for a hardcoded arXiv id, and SHALL NOT mount this trigger in production.
The trigger SHALL NOT alter the existing server, its authentication, or the
AppRouter type.

#### Scenario: The trigger is available in development and absent in production

- **WHEN** the server runs outside production
- **THEN** a dev trigger route invokes `runOnce` and returns the published Post,
  while in production the route is not mounted and the existing routes, auth, and
  AppRouter type are unchanged

