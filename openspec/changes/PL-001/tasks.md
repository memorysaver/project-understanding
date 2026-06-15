## 1. Schema

- [ ] 1.1 Add `packages/db/src/schema/paperlens.ts` with Drizzle table defs for
  `papers` (arxiv_id PK/UNIQUE, title, authors JSON, abstract, source_url,
  full_text_url, pdf_url, status enum default `discovered`, discovered_at,
  updated_at).
- [ ] 1.2 Add `digests` (id, paper_id FK, contributions/methods/results JSON,
  raw_json, model, created_at).
- [ ] 1.3 Add `style_prompts` (id, content, is_active boolean, created_at,
  updated_at).
- [ ] 1.4 Add `posts` (id, paper_id FK, digest_id FK, style_prompt_id FK, title,
  body, citation, tags JSON nullable, status enum, published_at nullable, model,
  created_at).
- [ ] 1.5 Add `runs` (id, trigger, status, started_at, finished_at, stats JSON).
- [ ] 1.6 Export the new tables from `packages/db/src/schema/index.ts` alongside
  the existing auth schema (do not modify auth tables).

## 2. Migrations & seed

- [ ] 2.1 Generate D1 migrations for the new tables (drizzle-kit / project
  convention) under `packages/db/src/migrations/`.
- [ ] 2.2 Add a seed that inserts exactly one active default StylePrompt.

## 3. Verification

- [ ] 3.1 Unit test: inserting a duplicate `arxiv_id` is a no-op (dedup).
- [ ] 3.2 Unit test: the single-active-StylePrompt invariant holds after seed and
  after an active-prompt update.
- [ ] 3.3 Unit test: a new paper defaults to status `discovered`; a published post
  has a non-null `published_at`.
- [ ] 3.4 Confirm migrations apply cleanly to an empty D1 and auth tables are
  untouched.
