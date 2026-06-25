## ADDED Requirements

### Requirement: Toggle a post's published status (auth-gated)
The system SHALL provide an auth-gated `setPostStatus` oRPC procedure that lets
the owner toggle a post between `published` and `unpublished` (and optionally edit
its body). An unpublished post SHALL NOT appear in the public feed; republishing
SHALL restore it. An unauthenticated call SHALL fail with `401` and SHALL NOT
read or mutate any post.

#### Scenario: Owner unpublishes a post and it disappears from the feed
- **WHEN** an owner with a valid session calls `setPostStatus` with a published
  post's id and `status = "unpublished"`
- **THEN** the post's status becomes `unpublished` and it no longer appears in
  the public feed (`listPosts` / `getPost`)

#### Scenario: Owner republishes an unpublished post
- **WHEN** an owner calls `setPostStatus` with an unpublished post's id and
  `status = "published"`
- **THEN** the post's status becomes `published`, it has a non-null
  `published_at`, and it reappears in the public feed

#### Scenario: Unauthenticated status change is rejected
- **WHEN** `setPostStatus` is called without a valid owner session
- **THEN** the call fails with `401` and no post is created or modified
