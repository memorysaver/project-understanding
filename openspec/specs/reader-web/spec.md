# reader-web Specification

## Purpose
TBD - created by archiving change PL-009-010. Update Purpose after archive.
## Requirements
### Requirement: Chronological feed page
The system SHALL provide a reader feed page at `/` that renders published posts in
reverse-chronological order (newest first) via the public `listPosts` procedure.
Each feed item SHALL link to that post's article page. The feed SHALL NOT present
any search or filter UI.

#### Scenario: Feed renders published posts newest-first
- **WHEN** a reader opens the feed page and `listPosts` returns published posts
- **THEN** the page renders the posts in the order returned (newest first), one item
  per post

#### Scenario: Each item links to its article
- **WHEN** the feed renders a post
- **THEN** the item is a link to that post's article page (`/posts/$id`)

#### Scenario: Empty feed
- **WHEN** `listPosts` returns no posts
- **THEN** the page renders an empty state rather than failing

### Requirement: Article page
The system SHALL provide an article page at `/posts/$id` that renders a published
post's title, body, and a link back to the source paper, fetched via the public
`getPost` procedure. The body is sanitized at publish time and is rendered as
formatted content.

#### Scenario: Article renders title, body, and source link
- **WHEN** a reader opens the article page for a published post id
- **THEN** the page renders the post's title and body, and a link to the source
  paper

### Requirement: Article not-found state
The system SHALL render a not-found state on the article page when `getPost` reports
the post as not found, which covers both unknown and unpublished ids (the Reader API
returns `NOT_FOUND` for both, indistinguishably).

#### Scenario: Unknown or unpublished id shows not found
- **WHEN** a reader opens the article page for an id that does not exist or is not
  published, and `getPost` responds with `NOT_FOUND`
- **THEN** the page renders a not-found state instead of an article and does not
  disclose whether a hidden post exists

