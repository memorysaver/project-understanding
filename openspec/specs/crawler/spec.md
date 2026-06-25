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

### Requirement: Discover a batch of recent arXiv papers and persist only new ones

The system SHALL provide a `discover({ db, fetcher?, ... })` function that queries
the arXiv API for a batch of recent papers, maps each entry to a Paper, and persists
each Paper in the `discovered` state. Persistence SHALL deduplicate by `arxiv_id`, so
only papers not already stored are persisted; papers already present (from a prior
run or a prior `fetchById`) SHALL NOT be persisted again and SHALL be left unchanged.
The function SHALL return the papers that were newly persisted on this run, so the
orchestrator can fan out over only the new work.

#### Scenario: A discovery run persists only papers not already seen

- **WHEN** `discover` runs and the arXiv batch includes both papers already stored
  and papers not yet stored
- **THEN** only the papers not already stored are persisted as new `discovered`
  Papers, the already-stored papers are left unchanged, and the run returns only the
  newly-persisted papers

#### Scenario: Re-running discovery produces no duplicates

- **WHEN** `discover` is run twice over the same arXiv batch
- **THEN** each paper exists exactly once (dedup by `arxiv_id`), the second run
  persists no new Papers, and the second run returns an empty set of new papers

### Requirement: Batch discovery respects the arXiv rate limit and custom User-Agent

Batch discovery SHALL send the crawler's custom `User-Agent` on every arXiv API
request and SHALL not exceed arXiv's recommended minimum interval between requests,
reusing the User-Agent and minimum-interval the crawler already exposes.

#### Scenario: Discovery requests carry a custom User-Agent

- **WHEN** `discover` makes a request to the arXiv API
- **THEN** the request includes the crawler's custom `User-Agent` header identifying
  PaperLens

#### Scenario: Multiple discovery requests honor the minimum interval

- **WHEN** discovery issues more than one arXiv API request in a single run
- **THEN** the requests are spaced by at least the crawler's recommended minimum
  interval so the arXiv rate limit is not exceeded

