# Lessons — Layer 0 Wave 2 (PL-003/004/005/006/008)

Cross-cutting findings from building the 4 pipeline stages + Reader API in parallel.
These are integration facts the next wave's builders should assume.

## Monorepo / package wiring

- **`@paperlens/db/schema` does NOT resolve.** The db package's `./*` export maps `.ts`
  files only, and `schema/` is a directory. Import the concrete module:
  `@paperlens/db/schema/paperlens` (entities) or `@paperlens/db/schema/index` (full schema
  for drizzle/tests). Never `@paperlens/db/schema`.
- **`@paperlens/db` root `createDb()` imports `cloudflare:workers`** (via
  `@paperlens/env/server`), which `bun test` cannot load. In tests, do NOT import the db
  root — import only `@paperlens/db/schema/paperlens` and inject your own in-memory
  `bun:sqlite` db with the real PL-001 migration applied.
- **Type the db handle broadly** as `BaseSQLiteDatabase<"sync" | "async", ...>` (matching
  `seed.ts`) so the same code satisfies both prod Cloudflare D1 and the bun-sqlite test db.
- The PL-001 migration `.sql` is resolved relative to the `@paperlens/db/seed` module via
  `import.meta.resolve` (again because the `./*` export only maps `.ts`).
- New packages: copy `packages/db/package.json` shape (type:module, exports `.`→`./src/index.ts`
  + `./*`→`./src/*.ts`, `workspace:*` / `catalog:` deps, devDeps `@paperlens/config` +
  `@types/bun` + `typescript:catalog`, tsconfig extends base).

## Testing pattern (offline + deterministic)

- **Dependency-inject** the external clients (arXiv/full-text `fetcher`, `llm.complete`) so
  stages run fully offline in tests; defaults wire to the real `@paperlens/llm` + arXiv. NO
  real network / no real OpenRouter calls in tests.
- In-memory `bun:sqlite` + applied migration + `seedDefaultStylePrompt` is the standard db
  test harness (see `packages/db/src/paperlens.test.ts`).

## API specifics

- Reader API procedures take `db` from the **oRPC request context** (`packages/api/src/context.ts`
  now carries a `db` handle); tests inject their own db and never call prod `createContext`.
- **Zod v4 quirk:** `.default({})` on an object with per-field defaults fails type-check (input
  type then requires all fields). Use `.optional()` + handler-side defaults instead.
- The `posts` schema has **no separate `link` column** — the source-paper link is carried
  inside the citation string.

## Lint / commit

- `oxfmt` (pre-commit) reformats source/spec files on commit — let it; re-validate openspec
  after. `oxlint` `no-control-regex` on an intentional control-char defense → use an
  `oxlint-disable-next-line` directive (not `--no-verify`).
- Commits staging **only non-JS files** (YAML/MD/openspec, e.g. the wrap commit) trip oxlint
  "No files found to lint" and abort → `git commit --no-verify`.

## Orchestration (what worked)

- 5 disjoint-package stories built as **native background subagents** (Agent `run_in_background`,
  NO `team_name`, no tmux) ran cleanly in parallel and auto-merged. Heartbeats via
  `.dev-workflow/signals/status.json` (gitignored) appeared within ~3s.
- Concurrent auto-merges to `main` only collided on `bun.lock` (disjoint source files merge
  clean); resolve by taking main's lockfile + `bun install` regenerate, re-test, merge.
  Related: [[aep-autopilot-executor-tmux-vs-native]], [[lefthook-oxlint-blocks-nonjs-commits]].
