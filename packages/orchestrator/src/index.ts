// @paperlens/orchestrator — the queue-coordinated pipeline (PL-018, ADR-001).
//
// The pipeline runs over a single Cloudflare Queue, one message per (paper,
// stage). `enqueueDiscovery` is the entry point: it creates a `Run` and enqueues
// a `discover` message. The `discover` handler is the only fan-out point — it
// enqueues one `digest` message per *new* paper. Each downstream stage handler
// reads its input from the prior durable D1 intermediate, invokes the existing
// stage module (≤1 LLM call), advances `Paper.status`, and enqueues the next
// stage. Every dependency is injected (db, queue producer, llm `complete`, the
// arXiv metadata / full-text fetchers) so the handlers run offline in tests; the
// defaults wire to the real clients.
//
// Idempotency (Cloudflare Queues are at-least-once → a stage CAN run twice):
// resume-from-stage, not whole-run short-circuit. A stage re-advances status only
// when the Paper is not already past that stage, and overwrites only its own
// single-per-Paper output, so a redelivered message resumes from the last good
// intermediate without duplicating output or redoing prior stages.
import { eq } from "drizzle-orm";
import { papers, runs, stylePrompts } from "@paperlens/db/schema/paperlens";
import type { PaperStatus } from "@paperlens/db/schema/paperlens";
import { complete as defaultComplete } from "@paperlens/llm";
import { fetchById, type CrawlerDb, type FetchLike } from "@paperlens/crawler";
import { fetchArxivFullText, type FullTextFetcher } from "@paperlens/digestor";
import { seedDefaultStylePrompt } from "@paperlens/db/seed";
import type { PipelineMessage, QueueProducer } from "./queue";

export type { PipelineMessage, QueueProducer } from "./queue";
export {
  PIPELINE_MESSAGE_TYPES,
  type PipelineMessageType,
  parsePipelineMessage,
} from "./queue";

/**
 * A small fixed arXiv seed the `discover` handler enumerates so the queue path
 * is exercisable end-to-end. Real arXiv batch discovery + dedup is PL-019; this
 * seed is the stand-in until the crawler grows a batch query.
 */
export const DISCOVERY_SEED = ["1706.03762"];

/**
 * Dependencies for the pipeline handlers. All are injectable so a handler runs
 * entirely offline in tests (in-memory db, fake queue, mocked llm, fixture
 * fetchers); each defaults to the real client/binding/fetcher in production.
 */
export type PipelineDeps = {
  /** PaperLens database. Defaults to the real D1-backed `createDb()`. */
  db?: CrawlerDb;
  /** Pipeline queue producer. Defaults to the bound `PIPELINE_QUEUE`. */
  queue?: QueueProducer;
  /** llm `complete` (shared by digestor + stylist). Defaults to the real client. */
  complete?: typeof defaultComplete;
  /** arXiv metadata HTTP fetcher (crawler). Defaults to the global `fetch`. */
  fetcher?: FetchLike;
  /** Full-text fetcher (digestor). Defaults to the arXiv HTML/abstract fetcher. */
  fetchFullText?: FullTextFetcher;
  /** The arXiv ids the `discover` handler enumerates. Defaults to the seed. */
  seed?: string[];
};

/** Resolve the injected db, or lazily construct the real D1-backed one. */
async function resolveDb(deps: PipelineDeps): Promise<CrawlerDb> {
  // `@paperlens/db`'s root pulls `cloudflare:workers` (only loadable inside a
  // Worker), so import `createDb` lazily — only when no db is injected. Tests
  // always inject an in-memory db and never hit this path.
  return deps.db ?? ((await import("@paperlens/db")).createDb() as unknown as CrawlerDb);
}

/** Resolve the injected queue producer, or lazily bind the real PIPELINE_QUEUE. */
async function resolveQueue(deps: PipelineDeps): Promise<QueueProducer> {
  if (deps.queue) return deps.queue;
  const { env } = await import("@paperlens/env/server");
  const binding = (env as unknown as { PIPELINE_QUEUE: { send(m: PipelineMessage): Promise<unknown> } })
    .PIPELINE_QUEUE;
  return { send: async (message) => void (await binding.send(message)) };
}

/**
 * Create a `Run` (recording its trigger) and enqueue a single `discover`
 * producer message carrying the new `runId`. This is the pipeline entry point
 * the manual trigger (PL-020) and Cron (PL-024) call.
 */
export async function enqueueDiscovery(
  trigger: "manual" | "cron",
  deps: PipelineDeps = {},
): Promise<{ runId: string }> {
  const db = await resolveDb(deps);
  const queue = await resolveQueue(deps);

  const run = (await db.insert(runs).values({ trigger, status: "running" }).returning())[0];
  if (!run) {
    throw new Error("enqueueDiscovery: failed to create Run");
  }

  await queue.send({ type: "discover", runId: run.id });
  return { runId: run.id };
}

/** Seed the default StylePrompt only when no active prompt exists (idempotent). */
async function ensureActiveStylePrompt(db: CrawlerDb): Promise<void> {
  const active = await db
    .select()
    .from(stylePrompts)
    .where(eq(stylePrompts.isActive, true))
    .limit(1);
  if (active.length === 0) {
    await seedDefaultStylePrompt(db);
  }
}

/** Linear rank of a Paper status, for the resume-from-stage idempotency guard. */
const STATUS_RANK: Record<PaperStatus, number> = {
  discovered: 0,
  digested: 1,
  styled: 2,
  published: 3,
  failed: -1,
};

/** Has the Paper already advanced at or past `status`? (resume guard) */
function isAtOrPast(current: PaperStatus, status: PaperStatus): boolean {
  return STATUS_RANK[current] >= STATUS_RANK[status];
}

/** Load a Paper by arXiv id, throwing if it has vanished. */
async function loadPaper(db: CrawlerDb, arxivId: string) {
  const paper = (await db.select().from(papers).where(eq(papers.arxivId, arxivId)))[0];
  if (!paper) {
    throw new Error(`orchestrator: paper not found: ${arxivId}`);
  }
  return paper;
}
