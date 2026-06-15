// @paperlens/orchestrator — the L0 inline pipeline (PL-007).
//
// `runOnce` drives a single arXiv paper through all four pipeline stages
// inline — crawl -> digest -> style -> publish — and returns the published
// Post. Inline is fine for one paper (the LLM is I/O-bound); the queue arrives
// at L1. Every stage is dependency-injected (db + llm `complete` + the arXiv
// metadata / full-text fetchers), so the whole pipeline is testable offline;
// the defaults wire to the real clients.
//
// Idempotency: re-running `runOnce` for the same id must not duplicate the
// Paper or the Post. The crawler already dedups the Paper (ON CONFLICT DO
// NOTHING on arxiv_id); the orchestrator short-circuits before re-digesting if
// the paper is already `published`, returning the existing Post.
import { eq } from "drizzle-orm";
import { papers, posts, stylePrompts } from "@paperlens/db/schema/paperlens";
import { complete as defaultComplete } from "@paperlens/llm";
import { fetchById, type CrawlerDb, type FetchLike } from "@paperlens/crawler";
import { run as runDigestor, fetchArxivFullText, type FullTextFetcher } from "@paperlens/digestor";
import { run as runStylist } from "@paperlens/stylist";
import { publish, type PublishedPost } from "@paperlens/publisher";
import { seedDefaultStylePrompt } from "@paperlens/db/seed";

// The arXiv id the dev trigger runs the pipeline against (acceptance criteria
// reference "a hardcoded arXiv ID"). "Attention Is All You Need".
export const DEFAULT_ARXIV_ID = "1706.03762";

/**
 * Dependencies for `runOnce`. All are injectable so the pipeline runs entirely
 * offline in tests (mocked llm, fixture fetchers, in-memory db); each defaults
 * to the real client/fetcher in production.
 */
export type RunOnceDeps = {
  /** PaperLens database. Defaults to the real D1-backed `createDb()`. */
  db?: CrawlerDb;
  /** llm `complete` (shared by digestor + stylist). Defaults to the real client. */
  complete?: typeof defaultComplete;
  /** arXiv metadata HTTP fetcher (crawler). Defaults to the global `fetch`. */
  fetcher?: FetchLike;
  /** Full-text fetcher (digestor). Defaults to the arXiv HTML/abstract fetcher. */
  fetchFullText?: FullTextFetcher;
};

/**
 * Run the full pipeline inline for one arXiv id and return the published Post.
 *
 * Stages run in order, threading the Paper through the status machine
 * discovered -> digested -> styled -> published:
 *   1. crawler.fetchById  — discover + persist the Paper (dedup by arxiv_id)
 *   2. digestor.run       — produce + persist the Digest, advance to digested
 *   3. stylist.run        — rewrite the digest into a styled body, advance to styled
 *   4. publisher.publish  — assemble + persist the published Post, advance to published
 *
 * Idempotent: if the paper is already `published`, the existing Post is returned
 * without re-running any stage, so a re-run adds no duplicate Paper or Post.
 */
export async function runOnce(
  arxivId: string = DEFAULT_ARXIV_ID,
  deps: RunOnceDeps = {},
): Promise<PublishedPost> {
  // `@paperlens/db`'s root pulls `cloudflare:workers` (only loadable inside a
  // Worker), so import `createDb` lazily — only when no db is injected. Tests
  // always inject an in-memory db and never hit this path.
  const db = deps.db ?? ((await import("@paperlens/db")).createDb() as unknown as CrawlerDb);
  const complete = deps.complete ?? defaultComplete;

  // Idempotency short-circuit: if this paper already produced a published Post,
  // return it instead of re-running the pipeline (no duplicate Paper/Post).
  const existing = await existingPublishedPost(db, arxivId);
  if (existing) {
    return existing;
  }

  // 1. Discover. ON CONFLICT DO NOTHING on arxiv_id, so re-discovery is a no-op.
  await fetchById({ id: arxivId, db, fetcher: deps.fetcher });

  // The stylist needs the single active StylePrompt as its voice. Seed the
  // default once if none is active (idempotent: only seeds when absent).
  await ensureActiveStylePrompt(db);

  // 2. Digest -> 3. Style -> 4. Publish, threading the Paper through the machine.
  const digest = await runDigestor({
    paperId: arxivId,
    db,
    fetchFullText: deps.fetchFullText ?? fetchArxivFullText,
    complete,
  });

  const styled = await runStylist({ db, complete }, { paperId: arxivId });

  const paper = (await db.select().from(papers).where(eq(papers.arxivId, arxivId)))[0];
  if (!paper) {
    throw new Error(`runOnce: paper vanished after digest/style: ${arxivId}`);
  }

  return publish(db, {
    paperId: arxivId,
    digestId: digest.id,
    stylePromptId: styled.stylePromptId,
    title: paper.title,
    styledBody: styled.body,
    model: styled.model,
  });
}

/** The published Post for a paper, if one already exists (idempotency check). */
async function existingPublishedPost(
  db: CrawlerDb,
  arxivId: string,
): Promise<PublishedPost | undefined> {
  const rows = await db.select().from(posts).where(eq(posts.paperId, arxivId));
  return rows.find((p) => p.status === "published");
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
