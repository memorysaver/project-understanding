## ADDED Requirements

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
