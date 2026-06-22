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
import { and, eq } from "drizzle-orm";
import { papers, posts, runs, stylePrompts } from "@paperlens/db/schema/paperlens";
import type { PaperStatus, RunStats } from "@paperlens/db/schema/paperlens";
import { complete as defaultComplete } from "@paperlens/llm";
import { fetchById, type CrawlerDb, type FetchLike } from "@paperlens/crawler";
import { run as runDigestor, fetchArxivFullText, type FullTextFetcher } from "@paperlens/digestor";
import { run as runStylist } from "@paperlens/stylist";
import { buildCitation, sanitizeBody } from "@paperlens/publisher";
import { seedDefaultStylePrompt } from "@paperlens/db/seed";
import type { PipelineMessage, QueueProducer } from "./queue";

export type { PipelineMessage, QueueProducer } from "./queue";
export { PIPELINE_MESSAGE_TYPES, type PipelineMessageType, parsePipelineMessage } from "./queue";

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
  const binding = (
    env as unknown as { PIPELINE_QUEUE: { send(m: PipelineMessage): Promise<unknown> } }
  ).PIPELINE_QUEUE;
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

// --- Per-stage handlers ------------------------------------------------------
//
// Each handler is a pure function of its durable D1 input intermediate: it loads
// its input, invokes the existing stage module (which advances Paper.status on
// success), and enqueues the next stage. The resume-from-stage guard makes a
// redelivery safe — a stage already past its transition re-enqueues the next
// message without redoing prior stages or regressing status.

/**
 * `discover` (the only fan-out point): enumerate the seed of arXiv ids, persist
 * each as a Paper via `crawler.fetchById` (dedup by arxiv_id, ON CONFLICT DO
 * NOTHING), and enqueue exactly one `digest` message per *new* paper. Real arXiv
 * batch query is PL-019; here a small fixed seed exercises the path.
 */
export async function handleDiscover(
  message: Extract<PipelineMessage, { type: "discover" }>,
  deps: PipelineDeps,
): Promise<void> {
  const db = await resolveDb(deps);
  const queue = await resolveQueue(deps);
  const seed = deps.seed ?? DISCOVERY_SEED;

  // The stylist needs the single active StylePrompt as its voice. Seed the
  // default once if none is active (idempotent: only seeds when absent).
  await ensureActiveStylePrompt(db);

  for (const arxivId of seed) {
    // A paper is "new" for fan-out purposes if it isn't already digested or
    // beyond — so a re-delivered discover (at-least-once) doesn't re-enqueue a
    // digest for a paper already moving down the pipeline. fetchById dedups the
    // row itself (ON CONFLICT DO NOTHING).
    const before = (await db.select().from(papers).where(eq(papers.arxivId, arxivId)))[0];
    await fetchById({ id: arxivId, db, fetcher: deps.fetcher });
    if (before && isAtOrPast(before.status, "digested")) {
      continue; // already past discovery — do not re-fan-out
    }
    await queue.send({ type: "digest", arxiv_id: arxivId, runId: message.runId });
  }
}

/**
 * `digest`: load the Paper, run the digestor (one LLM call → persists the Digest
 * and advances `discovered → digested`), then enqueue `style`. Resume-safe: if
 * the Paper is already at/past `digested`, the digestor is skipped and `style`
 * is re-enqueued from the existing Digest intermediate.
 */
export async function handleDigest(
  message: Extract<PipelineMessage, { type: "digest" }>,
  deps: PipelineDeps,
): Promise<void> {
  const db = await resolveDb(deps);
  const queue = await resolveQueue(deps);
  const complete = deps.complete ?? defaultComplete;

  const paper = await loadPaper(db, message.arxiv_id);
  if (!isAtOrPast(paper.status, "digested")) {
    await runDigestor({
      paperId: message.arxiv_id,
      db,
      fetchFullText: deps.fetchFullText ?? fetchArxivFullText,
      complete,
    });
  }

  await queue.send({ type: "style", arxiv_id: message.arxiv_id, runId: message.runId });
}

/**
 * `style`: load the Digest intermediate + active StylePrompt, run the stylist
 * (one LLM call → returns the styled body and advances `digested → styled`),
 * persist the styled body as the durable style intermediate (a single
 * `draft` Post per paper, upserted in place), then enqueue `publish`. Resume-safe:
 * if the Paper is already at/past `styled`, the stylist is skipped and `publish`
 * is re-enqueued from the existing draft Post.
 */
export async function handleStyle(
  message: Extract<PipelineMessage, { type: "style" }>,
  deps: PipelineDeps,
): Promise<void> {
  const db = await resolveDb(deps);
  const queue = await resolveQueue(deps);
  const complete = deps.complete ?? defaultComplete;

  if (!isAtOrPast((await loadPaper(db, message.arxiv_id)).status, "styled")) {
    const styled = await runStylist({ db, complete }, { paperId: message.arxiv_id });
    await upsertDraftPost(db, {
      paperId: message.arxiv_id,
      digestId: styled.digestId,
      stylePromptId: styled.stylePromptId,
      body: styled.body,
      model: styled.model,
    });
  }

  await queue.send({ type: "publish", arxiv_id: message.arxiv_id, runId: message.runId });
}

/**
 * `publish` (terminal, NO LLM call): load the styled body (the `draft` Post
 * intermediate) + Paper, finalize the Post in place to `status = published`
 * (sanitize the body, build the citation from verified Paper metadata, stamp
 * `published_at`), and advance `styled → published`. Resume-safe: if the Paper
 * is already `published`, this is a no-op. No next message is enqueued.
 */
export async function handlePublish(
  message: Extract<PipelineMessage, { type: "publish" }>,
  deps: PipelineDeps,
): Promise<void> {
  const db = await resolveDb(deps);

  const paper = await loadPaper(db, message.arxiv_id);
  if (isAtOrPast(paper.status, "published")) {
    return; // already published (terminal) — nothing to redo, nothing to enqueue
  }

  const draft = (
    await db
      .select()
      .from(posts)
      .where(and(eq(posts.paperId, message.arxiv_id), eq(posts.status, "draft")))
  )[0];
  if (!draft) {
    throw new Error(`orchestrator: no styled (draft) Post to publish for ${message.arxiv_id}`);
  }

  const citation = buildCitation({
    arxivId: paper.arxivId,
    title: paper.title,
    authors: paper.authors,
    sourceUrl: paper.sourceUrl,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(posts)
      .set({
        title: paper.title,
        body: sanitizeBody(draft.body),
        citation,
        status: "published",
        publishedAt: new Date(),
      })
      .where(eq(posts.id, draft.id));
    await tx
      .update(papers)
      .set({ status: "published" })
      .where(eq(papers.arxivId, message.arxiv_id));
  });
}

/**
 * Upsert the single `draft` Post that carries a paper's styled body (the style
 * stage's durable intermediate). Idempotent: a redelivered `style` overwrites the
 * one draft in place rather than inserting a second Post.
 */
async function upsertDraftPost(
  db: CrawlerDb,
  args: { paperId: string; digestId: string; stylePromptId: string; body: string; model: string },
): Promise<void> {
  const existing = (
    await db
      .select()
      .from(posts)
      .where(and(eq(posts.paperId, args.paperId), eq(posts.status, "draft")))
  )[0];
  if (existing) {
    await db
      .update(posts)
      .set({
        body: args.body,
        digestId: args.digestId,
        stylePromptId: args.stylePromptId,
        model: args.model,
      })
      .where(eq(posts.id, existing.id));
    return;
  }
  await db.insert(posts).values({
    paperId: args.paperId,
    digestId: args.digestId,
    stylePromptId: args.stylePromptId,
    title: "", // finalized from verified Paper metadata at publish
    body: args.body,
    citation: "", // built from verified Paper metadata at publish
    status: "draft",
    model: args.model,
  });
}

// --- Dispatch + failure ------------------------------------------------------

/** Per-message delivery context the consumer threads in from the Queue runtime. */
export type DispatchContext = {
  /** 1-based delivery attempt for this message (Cloudflare `Message.attempts`). */
  attempt: number;
  /** Max redeliveries before the message is exhausted (queue consumer setting). */
  maxRetries: number;
};

/**
 * Dispatch one pipeline message to its stage handler. On a stage error this
 * rethrows so the Queue redelivers (resume-from-stage) — UNLESS the retry budget
 * is exhausted, in which case the Paper is marked `failed`, the failure is
 * recorded on the `Run`, no next stage is enqueued, and the error is swallowed
 * (the message is acked, not retried). The consumer is a thin router; all
 * pipeline logic lives here.
 */
export async function dispatch(
  message: PipelineMessage,
  deps: PipelineDeps,
  ctx: DispatchContext,
): Promise<void> {
  try {
    switch (message.type) {
      case "discover":
        return await handleDiscover(message, deps);
      case "digest":
        return await handleDigest(message, deps);
      case "style":
        return await handleStyle(message, deps);
      case "publish":
        return await handlePublish(message, deps);
    }
  } catch (error) {
    // Exhausted the retry budget: this delivery was the last allowed attempt.
    if (ctx.attempt > ctx.maxRetries) {
      await markFailed(deps, message, error);
      return; // swallow → ack; do not enqueue any further stage
    }
    throw error; // within budget → rethrow so the Queue redelivers (backoff)
  }
}

/**
 * Terminal failure (after `max_retries` on a stage): set the Paper's status to
 * `failed` and record the failure on the `Run`. Discovery has no single Paper to
 * fail, so only the Run is marked. Escalation per failure class is L2 (PL-024).
 */
async function markFailed(
  deps: PipelineDeps,
  message: PipelineMessage,
  error: unknown,
): Promise<void> {
  const db = await resolveDb(deps);

  if (message.type !== "discover") {
    await db.update(papers).set({ status: "failed" }).where(eq(papers.arxivId, message.arxiv_id));
  }

  const run = (await db.select().from(runs).where(eq(runs.id, message.runId)))[0];
  const failedReason = error instanceof Error ? error.message : String(error);
  const stats: RunStats = {
    discovered: run?.stats?.discovered ?? 0,
    digested: run?.stats?.digested ?? 0,
    styled: run?.stats?.styled ?? 0,
    published: run?.stats?.published ?? 0,
    failed: (run?.stats?.failed ?? 0) + 1,
  };
  await db.update(runs).set({ status: "failed", stats }).where(eq(runs.id, message.runId));
  // Surface the reason for diagnosis; alerting per failure class is PL-024.
  const target = message.type === "discover" ? `run ${message.runId}` : message.arxiv_id;
  console.error(
    `orchestrator: ${message.type} for ${target} failed after max retries: ${failedReason}`,
  );
}

// --- Single-paper synchronous driver (offline eval / smoke) ------------------

/** A finalized, published Post row, as `runPipelineOnce` returns. */
export type PublishedPost = typeof posts.$inferSelect;

/**
 * Drive ONE arXiv id through the full pipeline synchronously in-process and
 * return its published Post. This is NOT the production path (the pipeline runs
 * over the queue, one message per invocation) — it is the offline equivalent for
 * the faithfulness eval / smoke runs (PL-011/PL-030): it threads the *same* stage
 * handlers (digest → style → publish) for a single paper through a local in-memory
 * queue, so it exercises the real transitions/intermediates without a Worker or a
 * real Queue. The discover fan-out is bypassed (it enumerates a fixed seed); the
 * caller supplies the single arxiv id directly.
 */
export async function runPipelineOnce(
  arxivId: string,
  deps: PipelineDeps = {},
): Promise<PublishedPost> {
  const db = await resolveDb(deps);

  // Local in-memory queue: stages enqueue their next message here; we drain it
  // synchronously so the whole pipeline runs in this one call.
  const pending: PipelineMessage[] = [];
  const localQueue: QueueProducer = { send: async (m) => void pending.push(m) };
  const driveDeps: PipelineDeps = { ...deps, db, queue: localQueue };

  await ensureActiveStylePrompt(db);
  await fetchById({ id: arxivId, db, fetcher: deps.fetcher });

  // Kick off at the digest stage for this single paper, then drain. attempt (1)
  // never exceeds maxRetries (1), so a stage error rethrows out of this call (the
  // eval records the id as failed) rather than being swallowed as a queue retry.
  pending.push({ type: "digest", arxiv_id: arxivId, runId: "eval" });
  while (pending.length > 0) {
    const message = pending.shift()!;
    await dispatch(message, driveDeps, { attempt: 1, maxRetries: 1 });
  }

  const post = (
    await db
      .select()
      .from(posts)
      .where(and(eq(posts.paperId, arxivId), eq(posts.status, "published")))
  )[0];
  if (!post) {
    throw new Error(`runPipelineOnce: pipeline produced no published Post for ${arxivId}`);
  }
  return post;
}
