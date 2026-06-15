## ADDED Requirements

### Requirement: Persist a published Post from a styled body

The system SHALL provide a `publish` operation that, from a styled body and its
source references, assembles and persists a `Post` with `status = "published"`
carrying a title, a renderable body, a citation, and a link back to the source
paper, and SHALL NOT set any tags at Layer 0.

#### Scenario: A published Post is created with all fields populated

- **WHEN** `publish` is called with a styled body for a known source Paper
- **THEN** a `Post` is persisted with `status = "published"`, a title, the body,
  a citation, and a link to the source paper, and with no tags

### Requirement: Citation built from the source Paper metadata

The system SHALL build the Post's citation from the source Paper's metadata —
its authors, title, arXiv id, and source link.

#### Scenario: Citation reflects the source paper

- **WHEN** `publish` assembles a Post for a Paper
- **THEN** the citation includes the Paper's authors, title, arXiv id, and the
  source link to that paper

### Requirement: Body sanitization before storage

The system SHALL sanitize the LLM-produced styled body before storing it as the
renderable Post body, removing unsafe markup — script-bearing elements, event
handler attributes, and script-bearing URLs — so the stored body is safe to
render.

#### Scenario: Unsafe markup is stripped

- **WHEN** the styled body contains a `<script>` element, an `on*` event-handler
  attribute, or a `javascript:` URL
- **THEN** the persisted body contains none of them while its readable text and
  safe formatting are preserved

### Requirement: Paper advances to published with a published_at stamp

The system SHALL advance the source Paper to `status = "published"` and SHALL set
the Post's `published_at` to a non-null timestamp when the Post is published.

#### Scenario: Publishing advances the Paper and stamps published_at

- **WHEN** `publish` persists a published Post for a Paper
- **THEN** the source Paper's status becomes `published` and the Post's
  `published_at` is a non-null timestamp
