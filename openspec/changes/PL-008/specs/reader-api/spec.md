## ADDED Requirements

### Requirement: List published posts
The system SHALL provide a public `listPosts` procedure that returns posts with
`status = "published"`, ordered by `published_at` descending (newest first), with
limit/offset pagination. The procedure SHALL NOT require authentication.

#### Scenario: Only published posts are returned
- **WHEN** `listPosts` is called and the database contains a mix of published,
  unpublished, and draft posts
- **THEN** it returns only the published posts and never includes any unpublished
  or draft post

#### Scenario: Newest published post first
- **WHEN** `listPosts` is called
- **THEN** the returned posts are ordered by `published_at` descending, newest first

#### Scenario: Pagination via limit and offset
- **WHEN** `listPosts` is called with a `limit` and `offset`
- **THEN** it returns at most `limit` published posts starting at `offset`,
  preserving the newest-first ordering

#### Scenario: Default response shape
- **WHEN** `listPosts` is called without input
- **THEN** it applies the default page size and returns the published posts plus the
  effective `limit` and `offset`

### Requirement: Get a published post by id
The system SHALL provide a public `getPost` procedure that returns a single post by
id only when its `status = "published"`. The procedure SHALL NOT require
authentication.

#### Scenario: Returns a published post
- **WHEN** `getPost` is called with the id of a published post
- **THEN** it returns that post

#### Scenario: Unpublished post is not found
- **WHEN** `getPost` is called with the id of an unpublished post
- **THEN** it throws a not-found error and does not return the post

#### Scenario: Draft post is not found
- **WHEN** `getPost` is called with the id of a draft post
- **THEN** it throws a not-found error and does not return the post

#### Scenario: Missing post is not found
- **WHEN** `getPost` is called with an id that does not exist
- **THEN** it throws a not-found error indistinguishable from the unpublished case,
  so the API never discloses whether a hidden post exists

### Requirement: No unpublished content leaks
The system SHALL ensure that neither `listPosts` nor `getPost` ever returns or
discloses a post whose `status` is not `published`.

#### Scenario: Unpublished content never observable
- **WHEN** any reader-api procedure is called against a database containing
  unpublished and draft posts
- **THEN** no field of any non-published post is ever included in a response, and a
  hidden post is reported identically to a non-existent one
