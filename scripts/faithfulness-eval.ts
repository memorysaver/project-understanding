// PL-011 — Layer-0 faithfulness eval harness (blind-grade sample).
//
// A two-phase, human-in-the-loop harness for measuring the pipeline's
// hallucination rate (the Layer-0 go/no-go gate is <= 10%):
//
//   1. `run`   — drive `orchestrator.runOnce` over ~20-30 arXiv ids and write,
//                per paper, a BUNDLE the grader reads (source abstract +
//                full-text excerpt vs the structured digest vs the styled post
//                body), PLUS a blank grades.csv (one row per paper) for a human
//                to fill in BLIND.
//   2. `score` — read the human-filled grades.csv and compute the aggregate
//                hallucination rate = sum(hallucinated) / sum(claims_total),
//                printing per-paper rows, the aggregate, and a PASS/FAIL verdict
//                against the <= 10% gate.
//
// Grading is HUMAN and BLIND — this script PREPARES the bundle and SCORES the
// human grades. It never auto-grades faithfulness.
//
// REAL runs need OPENROUTER_API_KEY in the environment (the harness reads no
// keys itself; it only forwards to the orchestrator's default llm client). For
// offline tests, the pipeline runner is dependency-injected (see `RunPaper`).
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
// Type-only — erased at runtime, so it never pulls the orchestrator value graph
// (which imports `cloudflare:workers`) into the offline test path.
import type { PipelineDeps } from "@paperlens/orchestrator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three artifacts a human compares to grade one paper's faithfulness. */
export type PaperBundle = {
  arxivId: string;
  /** What the post is supposed to be faithful TO. */
  source: {
    title: string;
    abstract: string;
    /** A bounded excerpt of the full text the digestor saw (may equal abstract). */
    fullTextExcerpt: string;
  };
  /** The structured digest the stylist rewrote. */
  digest: {
    contributions: string[];
    methods: string[];
    results: string[];
  };
  /** The published, reader-facing post body. */
  post: {
    title: string;
    body: string;
  };
};

/**
 * Runs the pipeline for one arXiv id and returns its bundle. The default
 * implementation wires `orchestrator.runPipelineOnce`; tests inject a fake so the
 * harness runs entirely offline (no network, no real db, no llm).
 */
export type RunPaper = (arxivId: string) => Promise<PaperBundle>;

/** One human-filled grade row: how many claims, how many unsupported. */
export type GradeRow = {
  arxivId: string;
  /** Total distinct claims the grader found in the post body. */
  claimsTotal: number;
  /** Of those, how many were hallucinated / unsupported by the source. */
  claimsHallucinated: number;
};

/** The aggregate scoring result against the <= 10% gate. */
export type ScoreResult = {
  perPaper: Array<GradeRow & { rate: number }>;
  totalClaims: number;
  totalHallucinated: number;
  /** sum(hallucinated) / sum(total); 0 when there are no claims. */
  aggregateRate: number;
  /** The Layer-0 go/no-go threshold (fraction, not percent). */
  gate: number;
  /** true iff aggregateRate <= gate. */
  pass: boolean;
};

/** The Layer-0 faithfulness gate: hallucination rate must be <= 10%. */
export const GATE = 0.1;

/** How many characters of the full text to carry into the bundle excerpt. */
const FULL_TEXT_EXCERPT_CHARS = 2000;

// ---------------------------------------------------------------------------
// Pure core (unit-testable): rate computation + verdict
// ---------------------------------------------------------------------------

/**
 * Aggregate hallucination rate = sum(hallucinated) / sum(claimsTotal).
 *
 * Edge case: when no paper has any claims (sum == 0) the rate is 0 — an empty
 * sample cannot be shown to hallucinate, so it does not fail the gate by
 * dividing by zero.
 */
export function computeRate(grades: GradeRow[]): number {
  const totalClaims = grades.reduce((sum, g) => sum + g.claimsTotal, 0);
  const totalHallucinated = grades.reduce((sum, g) => sum + g.claimsHallucinated, 0);
  if (totalClaims === 0) return 0;
  return totalHallucinated / totalClaims;
}

/** Per-paper rate; 0 when that paper has no claims. */
function perPaperRate(g: GradeRow): number {
  return g.claimsTotal === 0 ? 0 : g.claimsHallucinated / g.claimsTotal;
}

/** Score a set of human grades into per-paper + aggregate + PASS/FAIL verdict. */
export function scoreGrades(grades: GradeRow[], gate: number = GATE): ScoreResult {
  const totalClaims = grades.reduce((sum, g) => sum + g.claimsTotal, 0);
  const totalHallucinated = grades.reduce((sum, g) => sum + g.claimsHallucinated, 0);
  const aggregateRate = computeRate(grades);
  return {
    perPaper: grades.map((g) => ({ ...g, rate: perPaperRate(g) })),
    totalClaims,
    totalHallucinated,
    aggregateRate,
    gate,
    pass: aggregateRate <= gate,
  };
}

// ---------------------------------------------------------------------------
// Pure core (unit-testable): bundle + grades-template rendering / parsing
// ---------------------------------------------------------------------------

/** Bound a string to `n` chars, marking truncation so graders aren't misled. */
function excerpt(text: string, n: number = FULL_TEXT_EXCERPT_CHARS): string {
  return text.length <= n ? text : `${text.slice(0, n)}\n…[truncated]`;
}

/**
 * Render one paper's bundle as the human-readable Markdown a blind grader reads:
 * SOURCE (the ground truth) above DIGEST and POST (what we must check against
 * it). Bounded excerpts keep the bundle readable.
 */
export function renderBundleMarkdown(b: PaperBundle): string {
  const list = (items: string[]) =>
    items.length ? items.map((x) => `- ${x}`).join("\n") : "_(none)_";
  return [
    `# ${b.arxivId} — faithfulness bundle`,
    "",
    "## SOURCE (ground truth)",
    "",
    `**Title:** ${b.source.title}`,
    "",
    "**Abstract:**",
    "",
    b.source.abstract,
    "",
    "**Full-text excerpt:**",
    "",
    excerpt(b.source.fullTextExcerpt),
    "",
    "## DIGEST (structured, to be checked against SOURCE)",
    "",
    "**Contributions:**",
    list(b.digest.contributions),
    "",
    "**Methods:**",
    list(b.digest.methods),
    "",
    "**Results:**",
    list(b.digest.results),
    "",
    "## POST (published body, to be checked against SOURCE)",
    "",
    `**Title:** ${b.post.title}`,
    "",
    b.post.body,
    "",
  ].join("\n");
}

const GRADES_HEADER = "arxiv_id,claims_total,claims_hallucinated";

/**
 * A blank grades CSV: header + one row per paper with empty grade cells for a
 * human to fill in BLIND after reading each bundle.
 */
export function renderGradesTemplate(arxivIds: string[]): string {
  return [GRADES_HEADER, ...arxivIds.map((id) => `${id},,`)].join("\n") + "\n";
}

/**
 * Parse a human-filled grades CSV back into rows. Blank/short lines and the
 * header are skipped; un-filled cells (empty) are treated as 0. Throws on a
 * malformed numeric cell so a typo can't silently skew the rate.
 */
export function parseGrades(csv: string): GradeRow[] {
  const rows: GradeRow[] = [];
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === GRADES_HEADER) continue;
    const [arxivId, total, hallucinated] = line.split(",").map((c) => c.trim());
    if (!arxivId) continue;
    const claimsTotal = parseCell(total, arxivId, "claims_total");
    const claimsHallucinated = parseCell(hallucinated, arxivId, "claims_hallucinated");
    rows.push({ arxivId, claimsTotal, claimsHallucinated });
  }
  return rows;
}

function parseCell(value: string | undefined, arxivId: string, column: string): number {
  if (value === undefined || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(
      `Invalid ${column} for ${arxivId}: ${JSON.stringify(value)} (expected a non-negative integer)`,
    );
  }
  return n;
}

// ---------------------------------------------------------------------------
// Default pipeline runner (wires orchestrator.runOnce; not used in tests)
// ---------------------------------------------------------------------------

/**
 * The default `RunPaper`: build an in-memory db, run the real pipeline into it,
 * then read back the paper + digest + post to assemble the bundle. Real runs
 * require OPENROUTER_API_KEY (forwarded via the orchestrator's default llm).
 *
 * Imports are dynamic so the offline test path (injected `RunPaper`) never
 * loads the orchestrator / db / drizzle graph.
 */
export const defaultRunPaper: RunPaper = async (arxivId) => {
  const { Database } = await import("bun:sqlite");
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  const { eq } = await import("drizzle-orm");
  const schema = await import("@paperlens/db/schema/index");
  const { runPipelineOnce } = await import("@paperlens/orchestrator");
  const { fetchArxivFullText } = await import("@paperlens/digestor");

  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  const migrationUrl = new URL(
    "../migrations/0000_keen_supernaut.sql",
    import.meta.resolve("@paperlens/db/schema/index"),
  );
  const migration = await Bun.file(migrationUrl).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.run(trimmed);
  }
  // runPipelineOnce's injectable db is typed against the crawler's narrower Db
  // shape; the bun-sqlite drizzle instance is structurally compatible at runtime.
  const db = drizzle(sqlite, { schema }) as unknown as NonNullable<PipelineDeps["db"]>;

  const post = await runPipelineOnce(arxivId, { db });

  const paper = (
    await db.select().from(schema.papers).where(eq(schema.papers.arxivId, arxivId))
  )[0];
  const digest = (
    await db.select().from(schema.digests).where(eq(schema.digests.id, post.digestId))
  )[0];
  if (!paper || !digest) {
    throw new Error(`defaultRunPaper: pipeline left no paper/digest for ${arxivId}`);
  }

  // The digestor's full text isn't persisted, so re-fetch it the same way the
  // pipeline did — this is the actual source-of-truth the model digested (it
  // falls back to the abstract internally only when no HTML source exists).
  const fullText = await fetchArxivFullText(paper);
  return {
    arxivId,
    source: { title: paper.title, abstract: paper.abstract, fullTextExcerpt: fullText },
    digest: {
      contributions: digest.contributions,
      methods: digest.methods,
      results: digest.results,
    },
    post: { title: post.title, body: post.body },
  };
};

// ---------------------------------------------------------------------------
// `run` phase: produce the bundle + blank grades template
// ---------------------------------------------------------------------------

export type RunHarnessArgs = {
  arxivIds: string[];
  outDir: string;
  /** Injected for tests; defaults to the real pipeline runner. */
  runPaper?: RunPaper;
};

export type RunHarnessResult = {
  bundlePaths: string[];
  gradesPath: string;
  /** ids that failed to run (the pipeline threw); excluded from the template. */
  failed: Array<{ arxivId: string; error: string }>;
};

/**
 * Run the pipeline over every id and write `<outDir>/bundles/<id>.md` plus a
 * single blank `<outDir>/grades.csv`. A paper that fails is recorded and skipped
 * (the rest of the sample still produces a usable bundle).
 */
export async function runHarness(args: RunHarnessArgs): Promise<RunHarnessResult> {
  const runPaper = args.runPaper ?? defaultRunPaper;
  const bundleDir = join(args.outDir, "bundles");
  await mkdir(bundleDir, { recursive: true });

  const bundlePaths: string[] = [];
  const graded: string[] = [];
  const failed: Array<{ arxivId: string; error: string }> = [];

  for (const arxivId of args.arxivIds) {
    try {
      const bundle = await runPaper(arxivId);
      const path = join(bundleDir, `${safeName(arxivId)}.md`);
      await writeFile(path, renderBundleMarkdown(bundle));
      bundlePaths.push(path);
      graded.push(arxivId);
    } catch (err) {
      failed.push({ arxivId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const gradesPath = join(args.outDir, "grades.csv");
  await writeFile(gradesPath, renderGradesTemplate(graded));
  return { bundlePaths, gradesPath, failed };
}

/** arXiv ids contain a dot/slash; keep filenames flat and safe. */
function safeName(arxivId: string): string {
  return arxivId.replace(/[^A-Za-z0-9._-]/g, "_");
}

// ---------------------------------------------------------------------------
// `score` phase: read filled grades, print per-paper + aggregate + verdict
// ---------------------------------------------------------------------------

/** Format a fraction as a percentage with one decimal (e.g. 0.125 -> "12.5%"). */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Render the human-readable score report (also used by the CLI). */
export function renderScoreReport(result: ScoreResult): string {
  const lines: string[] = [];
  lines.push("Per-paper faithfulness:");
  for (const p of result.perPaper) {
    lines.push(
      `  ${p.arxivId}: ${p.claimsHallucinated}/${p.claimsTotal} unsupported (${pct(p.rate)})`,
    );
  }
  lines.push("");
  lines.push(
    `Aggregate: ${result.totalHallucinated}/${result.totalClaims} unsupported = ${pct(result.aggregateRate)}`,
  );
  lines.push(`Gate: <= ${pct(result.gate)}`);
  lines.push(`Verdict: ${result.pass ? "PASS" : "FAIL"} (Layer-0 go/no-go)`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Minimal `--flag value` parser (no deps); repeated flags take the last value. */
function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

/** Resolve `--ids` (a comma list, or a path to a file of one id per line). */
async function resolveIds(idsArg: string): Promise<string[]> {
  if (idsArg.includes(",") || !(await fileExists(idsArg))) {
    return idsArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const text = await readFile(idsArg, "utf8");
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

const USAGE = `faithfulness-eval — Layer-0 blind-grade faithfulness harness

Usage:
  bun scripts/faithfulness-eval.ts run   --ids <file|comma-list> --out <dir>
  bun scripts/faithfulness-eval.ts score --grades <file>

run:   runs the pipeline over each arXiv id and writes per-paper bundles
       (source vs digest vs post) + a blank grades.csv to <dir>.
       REAL runs need OPENROUTER_API_KEY in the environment.
score: reads the human-filled grades.csv and prints per-paper + aggregate
       hallucination rate + PASS/FAIL against the <= 10% Layer-0 gate.`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);

  if (command === "run") {
    if (!flags.ids || !flags.out) {
      console.error("run requires --ids <file|comma-list> and --out <dir>\n");
      console.error(USAGE);
      return 1;
    }
    const arxivIds = await resolveIds(flags.ids);
    if (arxivIds.length === 0) {
      console.error("No arXiv ids resolved from --ids.");
      return 1;
    }
    const result = await runHarness({ arxivIds, outDir: flags.out });
    console.log(`Wrote ${result.bundlePaths.length} bundle(s) to ${join(flags.out, "bundles")}`);
    console.log(`Blank grades template: ${result.gradesPath}`);
    if (result.failed.length) {
      console.log(`Skipped ${result.failed.length} failed paper(s):`);
      for (const f of result.failed) console.log(`  ${f.arxivId}: ${f.error}`);
    }
    console.log("Now grade each bundle BLIND, fill grades.csv, then run `score`.");
    return 0;
  }

  if (command === "score") {
    if (!flags.grades) {
      console.error("score requires --grades <file>\n");
      console.error(USAGE);
      return 1;
    }
    const csv = await readFile(flags.grades, "utf8");
    const grades = parseGrades(csv);
    const result = scoreGrades(grades);
    console.log(renderScoreReport(result));
    return result.pass ? 0 : 1;
  }

  console.error(USAGE);
  return command ? 1 : 0;
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).then((code) => process.exit(code));
}
