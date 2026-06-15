# persistence Specification

## Purpose
TBD - created by archiving change PL-001. Update Purpose after archive.
## Requirements
### Requirement: Core domain schema and migrations
The system SHALL define a Drizzle ORM schema and Cloudflare D1 migrations for the
core entities `Paper`, `Digest`, `StylePrompt`, `Post`, and `Run`, without
modifying the existing Better Auth tables.

#### Scenario: Migrations create all core tables
- **WHEN** the D1 migrations are applied to an empty database
- **THEN** tables for papers, digests, style_prompts, posts, and runs exist with
  the documented columns, and the existing auth tables are unchanged

### Requirement: Paper deduplication by arXiv id
The system SHALL treat `arxiv_id` as the unique identity of a paper so the same
paper is never stored twice.

#### Scenario: Inserting a duplicate arXiv id is a no-op
- **WHEN** a paper with an `arxiv_id` that already exists is inserted
- **THEN** the insert is a no-op (ON CONFLICT DO NOTHING) and no duplicate row is
  created

### Requirement: Paper status state machine
The system SHALL model a paper's lifecycle as a status field with the values
`discovered`, `digested`, `styled`, `published`, and `failed`, defaulting to
`discovered` on creation.

#### Scenario: New paper starts as discovered
- **WHEN** a paper is created from a freshly crawled arXiv entry
- **THEN** its status is `discovered`

### Requirement: Single active style prompt
The system SHALL guarantee exactly one `StylePrompt` row is active at any time and
SHALL seed one default active prompt.

#### Scenario: Seed creates exactly one active prompt
- **WHEN** the database is seeded
- **THEN** exactly one StylePrompt row has `is_active = true`

### Requirement: Published post invariant
The system SHALL ensure a `Post` with status `published` always has a non-null
`published_at` timestamp.

#### Scenario: Publishing sets published_at
- **WHEN** a post transitions to status `published`
- **THEN** its `published_at` is set to a non-null timestamp

