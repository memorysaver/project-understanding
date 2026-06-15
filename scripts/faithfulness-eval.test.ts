/// <reference types="bun" />
import { expect, test, describe } from "bun:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeRate,
  scoreGrades,
  parseGrades,
  renderGradesTemplate,
  renderBundleMarkdown,
  runHarness,
  GATE,
  type GradeRow,
  type PaperBundle,
  type RunPaper,
} from "./faithfulness-eval";

// ---------------------------------------------------------------------------
// Unit: rate computation + verdict (the scoring core)
// ---------------------------------------------------------------------------

describe("PL-011 rate computation", () => {
  // AC2 — the aggregate rate is sum(hallucinated)/sum(total), claim-weighted.
  test("aggregate rate is claim-weighted across papers", () => {
    const grades: GradeRow[] = [
      { arxivId: "a", claimsTotal: 10, claimsHallucinated: 1 },
      { arxivId: "b", claimsTotal: 30, claimsHallucinated: 3 },
    ];
    // 4 / 40 = 0.1 — NOT the unweighted mean of (0.1, 0.1) which also = 0.1,
    // so use an asymmetric case to prove weighting:
    const skewed: GradeRow[] = [
      { arxivId: "a", claimsTotal: 2, claimsHallucinated: 2 }, // per-paper 100%
      { arxivId: "b", claimsTotal: 18, claimsHallucinated: 0 }, // per-paper 0%
    ];
    expect(computeRate(grades)).toBeCloseTo(0.1, 10);
    // Claim-weighted: 2/20 = 0.1, NOT the unweighted mean (50%).
    expect(computeRate(skewed)).toBeCloseTo(0.1, 10);
  });

  // Edge case: a sample with zero total claims must not divide by zero.
  test("zero total claims yields rate 0 (no divide-by-zero) and PASSes", () => {
    const grades: GradeRow[] = [
      { arxivId: "a", claimsTotal: 0, claimsHallucinated: 0 },
      { arxivId: "b", claimsTotal: 0, claimsHallucinated: 0 },
    ];
    expect(computeRate(grades)).toBe(0);
    const result = scoreGrades(grades);
    expect(result.aggregateRate).toBe(0);
    expect(result.pass).toBe(true);
    expect(result.perPaper[0]!.rate).toBe(0);
  });

  test("empty grades yields rate 0 and PASS", () => {
    expect(computeRate([])).toBe(0);
    expect(scoreGrades([]).pass).toBe(true);
  });

  // Verdict boundary: exactly at the gate PASSes; just over FAILs.
  test("verdict is PASS at the gate and FAIL just over it", () => {
    const atGate: GradeRow[] = [{ arxivId: "a", claimsTotal: 100, claimsHallucinated: 10 }];
    const overGate: GradeRow[] = [{ arxivId: "a", claimsTotal: 100, claimsHallucinated: 11 }];
    expect(GATE).toBe(0.1);
    const at = scoreGrades(atGate);
    expect(at.aggregateRate).toBeCloseTo(0.1, 10);
    expect(at.pass).toBe(true);
    const over = scoreGrades(overGate);
    expect(over.aggregateRate).toBeCloseTo(0.11, 10);
    expect(over.pass).toBe(false);
  });

  test("scoreGrades reports per-paper rate, totals, and the gate", () => {
    const grades: GradeRow[] = [
      { arxivId: "a", claimsTotal: 4, claimsHallucinated: 1 },
      { arxivId: "b", claimsTotal: 6, claimsHallucinated: 0 },
    ];
    const r = scoreGrades(grades);
    expect(r.totalClaims).toBe(10);
    expect(r.totalHallucinated).toBe(1);
    expect(r.aggregateRate).toBeCloseTo(0.1, 10);
    expect(r.gate).toBe(0.1);
    expect(r.perPaper.find((p) => p.arxivId === "a")!.rate).toBeCloseTo(0.25, 10);
    expect(r.perPaper.find((p) => p.arxivId === "b")!.rate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unit: grades template + parse round-trip
// ---------------------------------------------------------------------------

describe("PL-011 grades template", () => {
  test("template has a header and one blank row per paper", () => {
    const csv = renderGradesTemplate(["2401.00001", "2402.99999"]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("arxiv_id,claims_total,claims_hallucinated");
    expect(lines).toContain("2401.00001,,");
    expect(lines).toContain("2402.99999,,");
    expect(lines).toHaveLength(3);
  });

  test("parseGrades skips header/blank lines and treats empty cells as 0", () => {
    const csv = [
      "arxiv_id,claims_total,claims_hallucinated",
      "a,10,1",
      "", // blank line
      "b,,", // un-filled -> 0,0
      "c, 5 , 2 ", // whitespace tolerated
    ].join("\n");
    const rows = parseGrades(csv);
    expect(rows).toEqual([
      { arxivId: "a", claimsTotal: 10, claimsHallucinated: 1 },
      { arxivId: "b", claimsTotal: 0, claimsHallucinated: 0 },
      { arxivId: "c", claimsTotal: 5, claimsHallucinated: 2 },
    ]);
  });

  test("parseGrades throws on a malformed numeric cell", () => {
    expect(() => parseGrades("a,ten,1")).toThrow(/claims_total/);
    expect(() => parseGrades("a,5,-1")).toThrow(/claims_hallucinated/);
    expect(() => parseGrades("a,5,1.5")).toThrow(/claims_hallucinated/);
  });

  test("a template round-trips to all-zero grades", () => {
    const csv = renderGradesTemplate(["a", "b"]);
    const rows = parseGrades(csv);
    expect(rows).toEqual([
      { arxivId: "a", claimsTotal: 0, claimsHallucinated: 0 },
      { arxivId: "b", claimsTotal: 0, claimsHallucinated: 0 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Integration: runHarness over a fixture set with an injected fake runPaper.
// Fully offline — no real runOnce, no network, no db, no llm.
// ---------------------------------------------------------------------------

function fakeBundle(arxivId: string): PaperBundle {
  return {
    arxivId,
    source: {
      title: `Paper ${arxivId}`,
      abstract: `Abstract for ${arxivId}.`,
      fullTextExcerpt: `Full text excerpt for ${arxivId}.`,
    },
    digest: {
      contributions: [`Contribution of ${arxivId}`],
      methods: [`Method of ${arxivId}`],
      results: [`Result of ${arxivId}`],
    },
    post: { title: `Post: ${arxivId}`, body: `<p>Styled body for ${arxivId}.</p>` },
  };
}

describe("PL-011 runHarness (offline, injected runPaper)", () => {
  // AC1 — running N papers produces a graded-output bundle (source vs digest vs post).
  test("writes one bundle per paper plus a blank grades template, no network", async () => {
    const ids = ["2401.00001", "2402.00002", "2403.00003"];
    const calls: string[] = [];
    const runPaper: RunPaper = async (id) => {
      calls.push(id);
      return fakeBundle(id);
    };
    const outDir = await mkdtemp(join(tmpdir(), "pl011-run-"));

    const result = await runHarness({ arxivIds: ids, outDir, runPaper });

    // The fake (not the real pipeline) ran for every id — proves DI + offline.
    expect(calls).toEqual(ids);
    expect(result.bundlePaths).toHaveLength(3);
    expect(result.failed).toHaveLength(0);

    // Each bundle contains all three artifacts under their headers.
    const files = (await readdir(join(outDir, "bundles"))).sort();
    expect(files).toEqual(["2401.00001.md", "2402.00002.md", "2403.00003.md"]);
    const md = await readFile(join(outDir, "bundles", "2401.00001.md"), "utf8");
    expect(md).toContain("## SOURCE (ground truth)");
    expect(md).toContain("Abstract for 2401.00001.");
    expect(md).toContain("## DIGEST");
    expect(md).toContain("Contribution of 2401.00001");
    expect(md).toContain("## POST");
    expect(md).toContain("Styled body for 2401.00001.");

    // A blank grades template with one fillable row per paper was produced.
    const grades = await readFile(result.gradesPath, "utf8");
    const rows = parseGrades(grades);
    expect(rows.map((r) => r.arxivId)).toEqual(ids);
    expect(rows.every((r) => r.claimsTotal === 0 && r.claimsHallucinated === 0)).toBe(true);
  });

  // A failing paper is recorded and excluded; the rest still produce a bundle.
  test("a paper whose pipeline throws is skipped, not fatal", async () => {
    const ids = ["good-1", "boom", "good-2"];
    const runPaper: RunPaper = async (id) => {
      if (id === "boom") throw new Error("simulated pipeline failure");
      return fakeBundle(id);
    };
    const outDir = await mkdtemp(join(tmpdir(), "pl011-fail-"));

    const result = await runHarness({ arxivIds: ids, outDir, runPaper });

    expect(result.bundlePaths).toHaveLength(2);
    expect(result.failed).toEqual([{ arxivId: "boom", error: "simulated pipeline failure" }]);
    // The grades template lists only the papers that produced a bundle.
    const rows = parseGrades(await readFile(result.gradesPath, "utf8"));
    expect(rows.map((r) => r.arxivId)).toEqual(["good-1", "good-2"]);
  });
});

// ---------------------------------------------------------------------------
// Unit: bundle rendering layout (source above digest/post)
// ---------------------------------------------------------------------------

describe("PL-011 bundle rendering", () => {
  test("renders source before digest before post", () => {
    const md = renderBundleMarkdown(fakeBundle("x"));
    const iSource = md.indexOf("## SOURCE");
    const iDigest = md.indexOf("## DIGEST");
    const iPost = md.indexOf("## POST");
    expect(iSource).toBeGreaterThanOrEqual(0);
    expect(iSource).toBeLessThan(iDigest);
    expect(iDigest).toBeLessThan(iPost);
  });
});
