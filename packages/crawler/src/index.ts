// @paperlens/crawler — the discovery stage of the PaperLens pipeline.
//
// Given an arXiv id, fetch the paper's metadata from the arXiv API and persist a
// Paper in the `discovered` state. arXiv is the only source in MVP; dedup is by
// arxiv_id (the Paper primary key) so re-fetching the same id never creates a
// duplicate. The DB and HTTP fetcher are injected so the stage is testable
// against an in-memory SQLite db and a fixture response — no real network.

import type { CrawlerDb, FetchLike } from "./types";
import { papers } from "@paperlens/db/schema/paperlens";
import { eq, inArray } from "drizzle-orm";
import { fetchArxivBatch, fetchArxivMetadata, parseArxivBatch } from "./arxiv";

export {
  ArxivError,
  parseArxivAtom,
  parseArxivBatch,
  fetchArxivMetadata,
  fetchArxivBatch,
  USER_AGENT,
  ARXIV_MIN_INTERVAL_MS,
} from "./arxiv";
export type { ArxivMetadata, CrawlerDb, FetchLike } from "./types";

/** Default arXiv search feed for MVP discovery (cs.CL recent submissions). */
const DEFAULT_QUERY = "cat:cs.CL";
/** Default batch size for a discovery run (one list-endpoint page). */
const DEFAULT_MAX_RESULTS = 25;

export interface FetchByIdArgs {
  /** The arXiv id to discover, e.g. "2401.00001". */
  id: string;
  /** PaperLens database (D1 in prod, in-memory SQLite in tests). */
  db: CrawlerDb;
  /**
   * HTTP fetcher used to reach the arXiv API. Defaults to the global `fetch`;
   * tests inject a fixture-backed fetcher so no real request is made.
   */
  fetcher?: FetchLike;
}

/** A persisted Paper row, as returned to the caller. */
export type Paper = typeof papers.$inferSelect;

/**
 * Discover an arXiv paper by id and persist it as a Paper(status=discovered).
 *
 * Fetches metadata (title, abstract, authors) and derives the source / full-text
 * / pdf URLs, then inserts a Paper. The insert is `ON CONFLICT DO NOTHING` on
 * arxiv_id, so calling `fetchById` again for the same id is a no-op for storage
 * (dedup). Returns the persisted Paper either way.
 */
export async function fetchById(args: FetchByIdArgs): Promise<Paper> {
  const { id, db } = args;
  const fetcher = args.fetcher ?? (globalThis.fetch as unknown as FetchLike);

  const metadata = await fetchArxivMetadata(id, fetcher);

  await db
    .insert(papers)
    .values({
      arxivId: metadata.arxivId,
      title: metadata.title,
      authors: metadata.authors,
      abstract: metadata.abstract,
      sourceUrl: metadata.sourceUrl,
      fullTextUrl: metadata.fullTextUrl,
      pdfUrl: metadata.pdfUrl,
    })
    .onConflictDoNothing();

  const rows = await db.select().from(papers).where(eq(papers.arxivId, metadata.arxivId));
  const paper = rows[0];
  if (!paper) {
    // Unreachable in practice: we just inserted (or the row already existed).
    throw new Error(`Paper "${id}" was not persisted`);
  }
  return paper;
}

export interface DiscoverArgs {
  /** PaperLens database (D1 in prod, in-memory SQLite in tests). */
  db: CrawlerDb;
  /**
   * HTTP fetcher used to reach the arXiv API. Defaults to the global `fetch`;
   * tests inject a fixture-backed fetcher so no real request is made.
   */
  fetcher?: FetchLike;
  /** Max papers to request in the batch (one list-endpoint page). */
  maxResults?: number;
  /** arXiv search query selecting the feed. Defaults to the MVP category feed. */
  query?: string;
}

/**
 * Discover a batch of recent arXiv papers and persist each as a
 * Paper(status=discovered). Queries the arXiv list endpoint, parses every entry,
 * and inserts each with `ON CONFLICT DO NOTHING` on arxiv_id — the same dedup
 * mechanism `fetchById` uses, so a paper already stored is never duplicated.
 *
 * Returns only the papers newly persisted on this run ("new" = not present in
 * `papers` before the run): a paper already stored (from a prior run or a prior
 * `fetchById`) is left unchanged and is NOT returned, so the orchestrator fans
 * out over genuinely new work. Re-running over the same batch returns [].
 */
export async function discover(args: DiscoverArgs): Promise<Paper[]> {
  const { db } = args;
  const fetcher = args.fetcher ?? (globalThis.fetch as unknown as FetchLike);
  const query = args.query ?? DEFAULT_QUERY;
  const maxResults = args.maxResults ?? DEFAULT_MAX_RESULTS;

  const xml = await fetchArxivBatch(query, maxResults, fetcher);
  const batch = parseArxivBatch(xml);
  if (batch.length === 0) return [];

  // Which ids already exist BEFORE this run — those are not "new".
  const ids = batch.map((m) => m.arxivId);
  const existingRows = await db
    .select({ arxivId: papers.arxivId })
    .from(papers)
    .where(inArray(papers.arxivId, ids));
  const existing = new Set(existingRows.map((r) => r.arxivId));

  await db
    .insert(papers)
    .values(
      batch.map((metadata) => ({
        arxivId: metadata.arxivId,
        title: metadata.title,
        authors: metadata.authors,
        abstract: metadata.abstract,
        sourceUrl: metadata.sourceUrl,
        fullTextUrl: metadata.fullTextUrl,
        pdfUrl: metadata.pdfUrl,
      })),
    )
    .onConflictDoNothing();

  const newIds = ids.filter((id) => !existing.has(id));
  if (newIds.length === 0) return [];
  return db.select().from(papers).where(inArray(papers.arxivId, newIds));
}
