## Why

The Layer-0 go/no-go gate for PaperLens is a faithfulness budget: **≤ 10% of a
blind-graded sample may contain a hallucinated or unsupported claim**
(product-context.yaml; `docs/technical-spec.md` § risks — "Halt auto-publish if
rate > gate"). The inline pipeline (PL-007) can now turn an arXiv id into a
published Post, but there is no way to _measure_ whether those posts are faithful
to their source papers. This is story PL-011: an eval harness that runs the
pipeline over a sample, prepares each paper for **blind human grading** (source
vs digest vs post), and computes the hallucination rate from the human grades so
the gate can be decided with evidence.

Grading must stay **human and blind** — an LLM grading its own pipeline's output
would not be trustworthy evidence for the gate. The harness therefore only
_prepares_ the bundle and _scores_ the human grades; it never auto-grades.

## What Changes

- Add `scripts/faithfulness-eval.ts`, a two-phase CLI:
  - `run --ids <file|comma-list> --out <dir>` — runs `orchestrator.runOnce` over
    each arXiv id and writes, per paper, a Markdown bundle (source abstract +
    full-text excerpt vs the structured digest vs the styled post body) plus a
    single blank `grades.csv` (one row per paper: `claims_total`,
    `claims_hallucinated`) for a human to fill in blind.
  - `score --grades <file>` — reads the human-filled grades and computes the
    aggregate hallucination rate = `sum(hallucinated) / sum(total)`, printing
    per-paper rates, the aggregate, and a PASS/FAIL verdict against the ≤ 10%
    gate.
- The pipeline runner is dependency-injected (default wires `runOnce`; tests
  inject a fake), and the rate-computation + bundle-building are factored into
  importable pure functions, so the harness is unit- and integration-testable
  **offline** (no network, no real db, no llm).
- Add `docs/faithfulness-eval.md` documenting how to run (set
  `OPENROUTER_API_KEY`, pick ~20–30 real arXiv ids, generate the bundle, grade
  blind, score) and how the ≤ 10% gate maps to the Layer-0 go/no-go.

## Capabilities

### New Capabilities

- `faithfulness-eval`: an offline-testable harness that prepares a blind-grade
  bundle (source vs digest vs post) over a sample of arXiv papers and computes
  the aggregate hallucination rate from human grades against the Layer-0 ≤ 10%
  gate. Grading is human; the harness never auto-grades.

### Modified Capabilities

<!-- none -->

## Impact

- `scripts/faithfulness-eval.ts` — new harness (CLI + importable pure functions),
  with offline unit + integration tests (`scripts/faithfulness-eval.test.ts`).
- `scripts/package.json`, `scripts/tsconfig.json` — minimal wiring so `bun test`
  and `bun run check-types` cover the harness; `scripts` added to the workspace.
- `docs/faithfulness-eval.md` — new operator/grader guide.
- Consumes `@paperlens/orchestrator` (`runOnce`) and `@paperlens/db`; no schema
  change, no change to any pipeline package, no production code path.
