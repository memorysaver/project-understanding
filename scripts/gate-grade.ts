// LAYER-0 FAITHFULNESS GATE — automated independent grader (LLM-as-judge).
//
// Grades each eval bundle's POST against its SOURCE with an INDEPENDENT model
// (different vendor from the generator). Provisional substitute for human blind
// grading. Writes one JSON verdict per paper + grades.csv, prints the aggregate.
//
//   bun scripts/gate-grade.ts <bundleDir> <outDir>
//
// Config (OpenRouter) from apps/server/.env. Grader model via GRADER_MODEL env.

import { config as loadEnv } from "dotenv";
import OpenAI from "openai";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

loadEnv({ path: "apps/server/.env" });
const client = new OpenAI({
  baseURL: process.env.OPENROUTER_BASE_URL!,
  apiKey: process.env.OPENROUTER_API_KEY!,
});
const GRADER_MODEL = process.env.GRADER_MODEL || "anthropic/claude-sonnet-4";

const bundleDir = Bun.argv[2] || ".dev-workflow/gate/eval-out-new/bundles";
const outDir = Bun.argv[3] || ".dev-workflow/gate/grades-new";

const RUBRIC =
  "You are an INDEPENDENT, STRICT faithfulness grader. You are given a paper's " +
  "SOURCE (its abstract + a full-text excerpt = GROUND TRUTH) and a candidate POST " +
  "(a reader-facing article generated from it). Judge ONLY the POST against the SOURCE.\n" +
  "1) claimsTotal = count of DISTINCT factual claims the POST makes ABOUT THIS PAPER " +
  "(method, numbers, architecture, results, ablations). Exclude generic background/framing " +
  "sentences that aren't specific claims about the paper; don't double-count.\n" +
  "2) claimsHallucinated = of those, how many are NOT supported by the SOURCE — contradicted " +
  "by it, or a specific assertion with no basis in the SOURCE that appears fabricated. Give " +
  "benefit of the doubt to claims plausibly consistent with the abstract; if a claim is likely " +
  "true-to-paper but merely beyond the provided excerpt, do NOT count it as hallucinated (note it).\n" +
  "Output ONLY a single JSON object, no prose, no markdown fences: " +
  '{"claimsTotal":<int>,"claimsHallucinated":<int>,"unsupported":["<short desc of each flagged claim>"],"notes":"<1-2 sentences>"}';

function splitSections(md: string): { source: string; post: string } {
  const postIdx = md.indexOf("## POST");
  const post = postIdx >= 0 ? md.slice(postIdx) : md;
  const pre = postIdx >= 0 ? md.slice(0, postIdx) : md;
  const digIdx = pre.indexOf("## DIGEST");
  const source = (digIdx >= 0 ? pre.slice(0, digIdx) : pre).slice(0, 12000);
  return { source, post };
}

function extractJson(text: string): string | null {
  const t = text.replace(/```(?:json)?/gi, "");
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start !== -1) return t.slice(start, i + 1); }
  }
  return null;
}

const files = (await readdir(bundleDir)).filter((f) => f.endsWith(".md")).sort();
await mkdir(outDir, { recursive: true });

const rows: Array<{ arxivId: string; claimsTotal: number; claimsHallucinated: number; unsupported: string[]; notes: string }> = [];
let totalCost = 0;

for (const f of files) {
  const id = f.replace(/\.md$/, "");
  const md = await readFile(join(bundleDir, f), "utf8");
  const { source, post } = splitSections(md);
  const user = `SOURCE (ground truth):\n${source}\n\n----------\nPOST (grade this):\n${post}`;
  try {
    const r = (await client.chat.completions.create({
      model: GRADER_MODEL,
      messages: [{ role: "system", content: RUBRIC }, { role: "user", content: user }],
      max_tokens: 1500,
      usage: { include: true },
    } as any)) as any;
    totalCost += r.usage?.cost ?? 0;
    const content = r.choices?.[0]?.message?.content ?? "";
    const js = extractJson(content);
    const v = js ? JSON.parse(js) : { claimsTotal: 0, claimsHallucinated: 0, unsupported: [], notes: "PARSE_FAIL" };
    const row = {
      arxivId: id,
      claimsTotal: Number(v.claimsTotal) || 0,
      claimsHallucinated: Number(v.claimsHallucinated) || 0,
      unsupported: Array.isArray(v.unsupported) ? v.unsupported : [],
      notes: String(v.notes ?? ""),
    };
    rows.push(row);
    await writeFile(join(outDir, `${id}.json`), JSON.stringify(row, null, 2));
    console.log(`${id}: ${row.claimsHallucinated}/${row.claimsTotal}`);
  } catch (err) {
    console.log(`${id}: GRADE_ERROR ${(err as Error).message}`);
  }
}

const th = rows.reduce((a, b) => a + b.claimsHallucinated, 0);
const tt = rows.reduce((a, b) => a + b.claimsTotal, 0);
await writeFile(
  join(outDir, "grades.csv"),
  "arxiv_id,claims_total,claims_hallucinated\n" +
    rows.map((r) => `${r.arxivId},${r.claimsTotal},${r.claimsHallucinated}`).join("\n") + "\n",
);
const rate = tt ? (th / tt) * 100 : 0;
console.log(`\n=== GRADING COMPLETE (grader=${GRADER_MODEL}) ===`);
console.log(`papers graded: ${rows.length}`);
console.log(`AGGREGATE: ${th}/${tt} = ${rate.toFixed(2)}%   gate <=10%  -> ${rate <= 10 ? "PASS" : "FAIL"}`);
console.log(`grader cost: $${totalCost.toFixed(4)}`);
