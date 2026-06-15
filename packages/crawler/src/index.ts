// @paperlens/crawler — the discovery stage of the PaperLens pipeline.
//
// Given an arXiv id, fetch the paper's metadata from the arXiv API and persist a
// Paper in the `discovered` state. arXiv is the only source in MVP; dedup is by
// arxiv_id (the Paper primary key) so re-fetching the same id never creates a
// duplicate. The DB and HTTP fetcher are injected so the stage is testable
// against an in-memory SQLite db and a fixture response — no real network.

import type { CrawlerDb, FetchLike } from "./types";
import { papers } from "@paperlens/db/schema/paperlens";
import { eq } from "drizzle-orm";
import { fetchArxivMetadata } from "./arxiv";

export {
  ArxivError,
  parseArxivAtom,
  fetchArxivMetadata,
  USER_AGENT,
  ARXIV_MIN_INTERVAL_MS,
} from "./arxiv";
export type { ArxivMetadata, CrawlerDb, FetchLike } from "./types";

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
