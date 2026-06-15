# Tasks

## 1. Harness core (importable, pure)

- [x] 1.1 `computeRate` / `scoreGrades` — claim-weighted aggregate rate +
      per-paper rate + PASS/FAIL verdict against the ≤ 10% gate, incl. the 0-total
      edge case → verify: unit tests.
- [x] 1.2 `renderGradesTemplate` / `parseGrades` — blank one-row-per-paper CSV and
      its round-trip parse (empty cells → 0; malformed cell throws) → verify: unit
      tests.
- [x] 1.3 `renderBundleMarkdown` — source above digest above post → verify: unit
      test asserts section order + content.

## 2. Run / score orchestration

- [x] 2.1 `runHarness` — run injected `RunPaper` over every id, write per-paper
      bundles + one blank grades template; skip failures → verify: integration test
      with a fake runner (offline).
- [x] 2.2 `defaultRunPaper` — wires `orchestrator.runOnce` into an in-memory db
      and reads back paper/digest/post (dynamic imports keep the test path offline) →
      verify: type-checks; offline tests never load it.
- [x] 2.3 CLI (`run` / `score`) with `--ids` (file or comma list), `--out`,
      `--grades`; exits 0 on PASS, 1 on FAIL → verify: `main` dispatch covered by the
      exported functions it calls.

## 3. Wiring + docs

- [x] 3.1 `scripts/package.json` + `scripts/tsconfig.json`; add `scripts` to the
      workspace so `bun test` and `bun run check-types` cover the harness → verify:
      `bun run check-types` clean.
- [x] 3.2 `docs/faithfulness-eval.md` — set `OPENROUTER_API_KEY`, pick ~20–30 real
      arXiv ids, generate bundle, grade blind, score, and the gate → go/no-go mapping.

## 4. Verification

- [x] 4.1 `bun test` green (unit + offline integration) and `bun run check-types`
      repo-wide clean.
- [x] 4.2 `openspec validate PL-011 --strict` clean.
