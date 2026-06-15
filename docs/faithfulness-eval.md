# Faithfulness eval harness (Layer-0 blind-grade sample)

The faithfulness harness measures how often PaperLens publishes claims that are
**not supported by the source paper** (hallucinations). It is the evidence behind
the **Layer-0 go/no-go gate: hallucination rate ≤ 10%** (`docs/technical-spec.md`
§ risks — "Halt auto-publish if rate > gate").

Grading is **human and blind**. The script does two things and nothing else:

1. `run` — drives the pipeline over a sample of arXiv papers and writes, per
   paper, a **bundle** the grader reads (source vs digest vs post) plus a blank
   grades sheet.
2. `score` — reads the human-filled grades sheet and computes the aggregate
   hallucination rate with a PASS/FAIL verdict against the gate.

The script never auto-grades faithfulness — a human reads each bundle and counts
the claims.

## Prerequisites

- `bun install` at the repo root.
- For **real** runs, export an OpenRouter key (the pipeline's llm client reads it;
  the harness itself hard-codes no keys):

  ```sh
  export OPENROUTER_API_KEY=sk-or-...
  ```

- A sample of **~20–30 real arXiv ids**. Put one id per line in a file
  (`#` comments and blank lines are ignored), e.g. `sample-ids.txt`:

  ```
  2401.00001
  1706.03762
  2312.11805
  # ...20–30 total
  ```

## 1. Generate the bundle

```sh
bun scripts/faithfulness-eval.ts run --ids sample-ids.txt --out eval-out
# or a comma list:
bun scripts/faithfulness-eval.ts run --ids 2401.00001,1706.03762 --out eval-out
```

This runs `orchestrator.runOnce` for each id and writes:

```
eval-out/
  bundles/
    2401.00001.md     # SOURCE (abstract + full-text excerpt) | DIGEST | POST
    1706.03762.md
    ...
  grades.csv          # blank: arxiv_id,claims_total,claims_hallucinated
```

Each bundle puts the **SOURCE (ground truth)** first, then the **DIGEST** and the
**POST** that must be checked against it. A paper whose pipeline call fails is
reported and skipped; the rest still produce a usable bundle.

## 2. Grade BLIND

For each `bundles/<id>.md`, a human reader:

1. Reads **only** the DIGEST and POST (the candidate output).
2. Counts every distinct factual claim → `claims_total`.
3. Counts how many of those claims are **not supported** by the SOURCE
   (hallucinated / unsupported / contradicted) → `claims_hallucinated`.
4. Fills the matching row in `grades.csv`.

"Blind" means the grader judges claims against the source **without** knowing the
aggregate result they are steering, and ideally without seeing which model/run
produced each post. Leave `claims_total` and `claims_hallucinated` as integers;
an un-filled cell counts as `0`.

## 3. Score

```sh
bun scripts/faithfulness-eval.ts score --grades eval-out/grades.csv
```

Prints per-paper rates, the aggregate, and the verdict:

```
Per-paper faithfulness:
  2401.00001: 1/12 unsupported (8.3%)
  1706.03762: 0/9 unsupported (0.0%)
  ...
Aggregate: 4/210 unsupported = 1.9%
Gate: <= 10.0%
Verdict: PASS (Layer-0 go/no-go)
```

The aggregate rate is **claim-weighted**: `sum(claims_hallucinated) /
sum(claims_total)` across the whole sample, not the mean of per-paper rates. A
sample with no claims scores `0%` (it cannot be shown to hallucinate). The
process exits `0` on PASS and `1` on FAIL, so it can gate CI or a release script.

## How the gate maps to Layer-0 go/no-go

- **PASS (rate ≤ 10%)** — faithfulness is within tolerance for Layer 0;
  auto-publish may proceed.
- **FAIL (rate > 10%)** — halt auto-publish (per the tech-spec risk table) and
  improve the digest/style prompts (or add grounding) before re-sampling.

Re-run `run` → grade → `score` on a fresh sample after any change to the digestor
or style prompt to confirm the gate still holds.
