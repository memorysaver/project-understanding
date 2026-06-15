# crawler Specification

## Purpose
TBD - created by archiving change PL-003. Update Purpose after archive.
## Requirements
### Requirement: Fetch and persist an arXiv paper by id

The system SHALL provide a `fetchById({ id, db, fetcher? })` function that fetches
a paper's metadata from the arXiv API for the given id and persists it as a
Paper. The persisted Paper SHALL carry its title, abstract, `source_url`, and
`full_text_url`, and SHALL be stored in the `discovered` state.

#### Scenario: Fetching a known arXiv id persists a discovered Paper

- **WHEN** `fetchById` is called with a known arXiv id and the arXiv API returns
  that paper's metadata
- **THEN** a Paper is persisted with the paper's title, abstract, `source_url`,
  and `full_text_url`, in the `discovered` state

### Requirement: Dedup on arXiv id

The system SHALL deduplicate Papers by arXiv id. Calling `fetchById` again for an
id that is already stored SHALL NOT create a duplicate Paper and SHALL leave the
existing Paper unchanged.

#### Scenario: Re-fetching the same id does not create a duplicate

- **WHEN** `fetchById` is called twice for the same arXiv id
- **THEN** exactly one Paper exists for that id and the originally stored Paper is
  left unchanged

### Requirement: Metadata mapping and URL derivation

The system SHALL map the arXiv API (Atom) response to the Paper fields — title,
abstract, and authors — and SHALL derive `source_url` (the abstract page),
`full_text_url` (the HTML rendering), and `pdf_url` from the arXiv id.

#### Scenario: Atom response maps to Paper fields and derived URLs

- **WHEN** an arXiv Atom entry for an id is parsed
- **THEN** the title, abstract, and authors are taken from the entry and
  `source_url`, `full_text_url`, and `pdf_url` are derived from the id

### Requirement: Respect arXiv rate limit and custom User-Agent

The system SHALL send a custom `User-Agent` on every arXiv API request and SHALL
expose arXiv's recommended minimum interval between requests so callers can
respect the rate limit.

#### Scenario: Requests carry a custom User-Agent

- **WHEN** `fetchById` makes a request to the arXiv API
- **THEN** the request includes a custom `User-Agent` header identifying PaperLens

