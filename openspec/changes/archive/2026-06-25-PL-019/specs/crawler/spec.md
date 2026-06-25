## ADDED Requirements

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
