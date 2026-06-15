// LAYER-0 FAITHFULNESS GATE — bun-compatible REAL runner.
//
// The documented `bun scripts/faithfulness-eval.ts run` path crashes under
// plain bun because `@paperlens/db` createDb() and `@paperlens/llm`
// getLlmConfig() both reach `cloudflare:workers` (Workers-only). This runner
// bypasses that entirely: it injects a file-backed bun:sqlite db, a
// reasoning-aware OpenRouter `complete` adapter (config from apps/server/.env),
// and the real arXiv fetchers into `orchestrator.runOnce`, then assembles
// faithfulness bundles via the exact harness format the `score` step expects.
//
// Usage:
//   bun scripts/gate-run.ts smoke           # one cheap paper (1706.03762), print artifacts
//   bun scripts/gate-run.ts full            # full 25-id run -> eval-out/
//
// NOT a build: produces eval artifacts only (no git, no PR, no commit).

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "@paperlens/db/schema/index";
import { seedDefaultStylePrompt } from "@paperlens/db/seed";
import { runOnce, type RunOnceDeps } from "@paperlens/orchestrator";
import { fetchArxivFullText } from "@paperlens/digestor";
import { digestSchema } from "@paperlens/digestor";
import {
  renderBundleMarkdown,
  renderGradesTemplate,
  type PaperBundle,
} from "./faithfulness-eval";

// ---------------------------------------------------------------------------
// Config (apps/server/.env — gitignored; never import @paperlens/env/server)
// ---------------------------------------------------------------------------

loadEnv({ path: "apps/server/.env" });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in apps/server/.env`);
  return v;
}

const OPENROUTER_BASE_URL = requireEnv("OPENROUTER_BASE_URL");
const OPENROUTER_API_KEY = requireEnv("OPENROUTER_API_KEY");
const MODELS: Record<"digest" | "style", string> = {
  digest: requireEnv("OPENROUTER_MODEL_DIGEST"),
  style: requireEnv("OPENROUTER_MODEL_STYLE"),
};

const GATE_IDS = [
  "1706.03762", "1810.04805", "2005.14165", "1512.03385", "1406.2661",
  "1412.6980", "2010.11929", "2203.02155", "1907.11692", "1409.1556",
  "1502.03167", "2201.11903", "1301.3781", "2302.13971", "1503.02531",
  "2006.11239", "1505.04597", "2104.08691", "1602.04938", "2005.11401",
  "1707.06347", "1312.5602", "2106.09685", "1411.1784", "1409.0473",
];
const SMOKE_ID = "1706.03762";

const DB_PATH = ".dev-workflow/gate.sqlite";
const MIGRATION_URL = new URL(
  "./migrations/0000_keen_supernaut.sql",
  import.meta.resolve("@paperlens/db/seed"),
);

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

async function heartbeat(phase: string, pct: number, note: string) {
  await mkdir(".dev-workflow/signals", { recursive: true });
  await writeFile(
    ".dev-workflow/signals/gate-status.json",
    JSON.stringify({ phase, pct, updated_at: new Date().toISOString(), note }) + "\n",
  );
}

// ---------------------------------------------------------------------------
// Cost / usage accounting (the LlmUsage type carries no cost; track here)
// ---------------------------------------------------------------------------

const totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, calls: 0 };

// ---------------------------------------------------------------------------
// Reasoning-aware OpenRouter `complete` adapter
// ---------------------------------------------------------------------------
//
// nvidia/nemotron-3-ultra-550b-a55b is a REASONING model: it spends completion
// budget on `reasoning` tokens, so a tight max_tokens yields empty `content`.
// Strategy: generous max_tokens (8000), retry ONCE at 16000 if empty, then fail.
// For the digest stage we need structured JSON; the model may not honor
// json_schema, so we instruct JSON in the prompt and robustly extract the first
// balanced JSON object out of the (possibly reasoning-laden) content.

const client = new OpenAI({ baseURL: OPENROUTER_BASE_URL, apiKey: OPENROUTER_API_KEY });

const JSON_INSTRUCTION =
  "\n\nRespond with ONLY a single JSON object, no markdown fences, no prose, " +
  'no preamble. The object MUST have exactly these keys: "contributions", ' +
  '"methods", "results" — each a non-empty array of short, faithful, ' +
  "self-contained bullet-point strings. Do not invent claims not supported " +
  "by the text.";

type RawMessage = { role: "system" | "user" | "assistant"; content: string };

async function rawComplete(
  model: string,
  messages: RawMessage[],
  maxTokens: number,
): Promise<{ content: string; model: string; usage: any }> {
  const completion = (await client.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens,
    // Ask OpenRouter to return cost accounting in `usage`.
    // (top-level passthrough; OpenRouter reads `usage.include`).
    usage: { include: true },
  } as any)) as any;

  const content = completion.choices?.[0]?.message?.content ?? "";
  return { content, model: completion.model ?? model, usage: completion.usage };
}

function recordUsage(usage: any) {
  if (!usage) return;
  totals.promptTokens += usage.prompt_tokens ?? 0;
  totals.completionTokens += usage.completion_tokens ?? 0;
  totals.totalTokens += usage.total_tokens ?? 0;
  // OpenRouter returns cost (USD) on usage.cost when usage.include is set.
  totals.cost += typeof usage.cost === "number" ? usage.cost : 0;
  totals.calls += 1;
}

/** Extract the first balanced JSON object from arbitrary text (strips fences/reasoning). */
function extractFirstJsonObject(text: string): string | null {
  // Drop ```json ... ``` fences if present, then scan for a balanced { ... }.
  const cleaned = text.replace(/```(?:json)?/gi, "");
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        return cleaned.slice(start, i + 1);
      }
    }
  }
  return null;
}

// The shape orchestrator/digestor/stylist expect from `@paperlens/llm` complete.
// Text path -> { content, model, usage }; schema path -> { json, model, usage }.
const completeAdapter = (async (args: {
  stage: "digest" | "style";
  messages: RawMessage[];
  schema?: typeof digestSchema;
}) => {
  const model = MODELS[args.stage];

  if (args.schema) {
    // DIGEST: structured. Inject JSON instruction into the system message.
    const messages = args.messages.map((m, i) =>
      i === 0 && m.role === "system"
        ? { ...m, content: m.content + JSON_INSTRUCTION }
        : m,
    );
    // If there was no system message, prepend the instruction defensively.
    if (!messages.some((m) => m.role === "system")) {
      messages.unshift({ role: "system", content: JSON_INSTRUCTION.trim() });
    }

    for (const maxTokens of [8000, 16000]) {
      const { content, usage } = await rawComplete(model, messages, maxTokens);
      recordUsage(usage);
      if (!content || content.trim().length === 0) {
        console.warn(`  [digest] empty content at max_tokens=${maxTokens}, retrying...`);
        continue;
      }
      const jsonStr = extractFirstJsonObject(content);
      if (!jsonStr) {
        console.warn(`  [digest] no JSON object found at max_tokens=${maxTokens}`);
        continue;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(jsonStr);
      } catch {
        console.warn(`  [digest] JSON.parse failed at max_tokens=${maxTokens}`);
        continue;
      }
      const parsed = digestSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(
          `  [digest] schema validation failed at max_tokens=${maxTokens}: ${parsed.error.message.slice(0, 200)}`,
        );
        continue;
      }
      return { json: parsed.data, model, usage: toLlmUsage(usage) };
    }
    throw new Error("digest: model returned empty/unparseable content after retries");
  }

  // STYLE: free text.
  for (const maxTokens of [8000, 16000]) {
    const { content, usage } = await rawComplete(model, args.messages, maxTokens);
    recordUsage(usage);
    if (content && content.trim().length > 0) {
      return { content, model, usage: toLlmUsage(usage) };
    }
    console.warn(`  [style] empty content at max_tokens=${maxTokens}, retrying...`);
  }
  throw new Error("style: model returned empty content after retries");
}) as unknown as NonNullable<RunOnceDeps["complete"]>;

function toLlmUsage(usage: any) {
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

// ---------------------------------------------------------------------------
// DB: file-backed bun:sqlite, migration applied once, default StylePrompt seeded
// ---------------------------------------------------------------------------

async function makeDb() {
  const sqlite = new Database(DB_PATH);
  sqlite.run("PRAGMA foreign_keys = ON");

  const hasPapers =
    sqlite
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='papers'")
      .get() !== null;
  if (!hasPapers) {
    const migration = await Bun.file(MIGRATION_URL).text();
    for (const statement of migration.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.run(trimmed);
    }
  }

  const db = drizzle(sqlite, { schema }) as unknown as NonNullable<RunOnceDeps["db"]>;

  // Seed exactly one active default StylePrompt if none is active (idempotent).
  const active = await db
    .select()
    .from(schema.stylePrompts)
    .where(eq(schema.stylePrompts.isActive, true))
    .limit(1);
  if (active.length === 0) {
    await seedDefaultStylePrompt(db as any);
  }

  return db;
}

// ---------------------------------------------------------------------------
// Run one paper through the real pipeline -> assemble a PaperBundle
// ---------------------------------------------------------------------------

// When FORCE_ABSTRACT_ONLY=1 the gate returns the abstract as the "full text",
// so the digestor's abstractOnly path (and the PL-030 guard) always fires —
// isolates the abstract-only fix even after ar5iv renders the paper's full text.
const forceAbstractOnly = process.env.FORCE_ABSTRACT_ONLY === "1";
const fetchFullTextForGate: typeof fetchArxivFullText = forceAbstractOnly
  ? async (paper) => paper.abstract
  : fetchArxivFullText;

async function runPaper(
  db: NonNullable<RunOnceDeps["db"]>,
  arxivId: string,
): Promise<PaperBundle> {
  // Real arXiv metadata fetcher (crawler default) + real full-text fetcher
  // (digestor default) + reasoning-aware OpenRouter complete + file-backed db.
  const post = await runOnce(arxivId, {
    db,
    complete: completeAdapter,
    fetchFullText: fetchFullTextForGate,
    // fetcher defaults to global fetch in the crawler -> real arXiv API.
  });

  const paper = (
    await db.select().from(schema.papers).where(eq(schema.papers.arxivId, arxivId))
  )[0];
  const digest = (
    await db.select().from(schema.digests).where(eq(schema.digests.id, post.digestId))
  )[0];
  if (!paper || !digest) {
    throw new Error(`pipeline left no paper/digest for ${arxivId}`);
  }

  // Re-fetch the full text the same way the digestor did (it isn't persisted).
  const fullText = await fetchFullTextForGate(paper);

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
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function smoke() {
  await heartbeat("smoke", 25, `running smoke on ${SMOKE_ID}`);
  console.log(`\n=== SMOKE: ${SMOKE_ID} (Attention Is All You Need) ===\n`);
  const db = await makeDb();
  const bundle = await runPaper(db, SMOKE_ID);

  // Assert a published Post is produced (runPaper throws otherwise; runOnce
  // only returns a published PublishedPost).
  console.log("--- STRUCTURED DIGEST ---");
  console.log("Contributions:");
  bundle.digest.contributions.forEach((c) => console.log(`  - ${c}`));
  console.log("Methods:");
  bundle.digest.methods.forEach((m) => console.log(`  - ${m}`));
  console.log("Results:");
  bundle.digest.results.forEach((r) => console.log(`  - ${r}`));
  console.log("\n--- STYLED POST BODY ---");
  console.log(`Title: ${bundle.post.title}\n`);
  console.log(bundle.post.body);
  console.log("\n--- TOKEN USAGE / COST (smoke) ---");
  console.log(
    `calls=${totals.calls} prompt=${totals.promptTokens} completion=${totals.completionTokens} total=${totals.totalTokens} cost=$${totals.cost.toFixed(6)}`,
  );
  await heartbeat("smoke", 35, "smoke passed: published post produced");
  return bundle;
}

async function full(idList: string[], limit?: number) {
  const ids = limit ? idList.slice(0, limit) : idList;
  await heartbeat("full-run", 40, `running ${ids.length}-id gate`);
  const db = await makeDb();
  const outDir = "eval-out";
  const bundleDir = join(outDir, "bundles");
  await mkdir(bundleDir, { recursive: true });

  const graded: string[] = [];
  const failed: Array<{ arxivId: string; error: string }> = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const safe = id.replace(/[^A-Za-z0-9._-]/g, "_");
    process.stdout.write(`[${i + 1}/${ids.length}] ${id} ... `);
    try {
      const bundle = await runPaper(db, id);
      await writeFile(join(bundleDir, `${safe}.md`), renderBundleMarkdown(bundle));
      graded.push(id);
      console.log("ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ arxivId: id, error: msg });
      console.log(`FAILED: ${msg}`);
    }
    await heartbeat(
      "full-run",
      40 + Math.round((50 * (i + 1)) / ids.length),
      `${graded.length} ok / ${failed.length} failed (${i + 1}/${ids.length})`,
    );
  }

  const gradesPath = join(outDir, "grades.csv");
  await writeFile(gradesPath, renderGradesTemplate(graded));

  console.log(`\n=== FULL RUN COMPLETE ===`);
  console.log(`Succeeded: ${graded.length}/${ids.length}`);
  if (failed.length) {
    console.log(`Failed: ${failed.length}`);
    for (const f of failed) console.log(`  ${f.arxivId}: ${f.error}`);
  }
  console.log(`Bundles: ${bundleDir}`);
  console.log(`Grades template: ${gradesPath}`);
  console.log(
    `\nTOTAL USAGE: calls=${totals.calls} prompt=${totals.promptTokens} completion=${totals.completionTokens} total=${totals.totalTokens} cost=$${totals.cost.toFixed(6)}`,
  );
  return { graded, failed };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const cmd = Bun.argv[2];
if (cmd === "smoke") {
  await smoke();
} else if (cmd === "full") {
  await full(GATE_IDS, Bun.argv[3] ? parseInt(Bun.argv[3], 10) : undefined);
} else if (cmd === "file") {
  const list = (await Bun.file(Bun.argv[3]!).text())
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
  await full(list, Bun.argv[4] ? parseInt(Bun.argv[4], 10) : undefined);
} else {
  console.error("usage: bun scripts/gate-run.ts <smoke | full [count] | file <ids> [count]>");
  process.exit(1);
}
