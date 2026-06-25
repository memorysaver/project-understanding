# digestor Specification

## Purpose
TBD - created by archiving change PL-004. Update Purpose after archive.
## Requirements
### Requirement: Structured Digest from full text
The system SHALL, for a given Paper, fetch the Paper's full text and produce a
structured Digest containing `contributions`, `methods`, and `results` derived
from that text, using `llm.complete` with a schema for structured output.

#### Scenario: Full text yields a structured digest
- **WHEN** the digestor runs for a Paper and the LLM returns a structured response
- **THEN** it produces a Digest with non-empty `contributions`, `methods`, and `results`

### Requirement: Injected full-text fetcher prefers arXiv HTML
The system SHALL obtain the full text through an injectable fetcher that prefers
the arXiv HTML source and falls back to the Paper's abstract, so callers (and
tests) can supply a deterministic, offline source. Full-PDF binary parsing SHALL
NOT be attempted.

#### Scenario: Fetcher is injected for a deterministic source
- **WHEN** the digestor runs with an injected full-text fetcher
- **THEN** the injected fetcher supplies the text passed to the LLM, with no network access

#### Scenario: Abstract fallback when no HTML source
- **WHEN** the default fetcher runs for a Paper that has no HTML full-text URL
- **THEN** it returns the Paper's stored abstract

### Requirement: Persist Digest and advance Paper status
The system SHALL persist the produced Digest linked to the Paper and advance the
Paper's status from `discovered` to `digested` atomically.

#### Scenario: Successful digest persists and advances status
- **WHEN** the digestor completes a Digest for a `discovered` Paper
- **THEN** the Digest is stored and linked to the Paper and the Paper's status becomes `digested`

### Requirement: No partial advance on LLM failure
The system SHALL, when the LLM call fails, throw the error so the caller can
retry, and SHALL leave the Paper at status `discovered` with no Digest written.

#### Scenario: LLM failure leaves the Paper untouched
- **WHEN** the LLM call throws during a digestor run
- **THEN** the digestor rethrows the error, no Digest is persisted, and the Paper remains at status `discovered`

### Requirement: Digest records its source kind (full text vs abstract)

The system SHALL persist a `source_kind` (`full_text | abstract`) on each Digest,
recording whether the digest was produced from the paper's full text or only from
its abstract. The digestor SHALL set `source_kind` from the abstract-only signal it
already detects (the fetched text equals the stored abstract → `abstract`, otherwise
`full_text`). A Digest produced from an abstract alone SHALL be queryable as
`abstract`.

#### Scenario: A digest produced from full text records source_kind full_text

- **WHEN** the digestor runs for a Paper and the injected full-text fetcher returns
  text other than the stored abstract
- **THEN** the persisted Digest records `source_kind = full_text`

#### Scenario: A digest produced from the abstract alone records source_kind abstract

- **WHEN** the digestor runs for a Paper whose full text is unavailable, so the
  fetcher falls back to the stored abstract
- **THEN** the persisted Digest records `source_kind = abstract` and is queryable as
  an abstract-only digest

