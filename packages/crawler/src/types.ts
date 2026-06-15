// @paperlens/crawler — public types for the discovery stage.
// The crawler fetches arXiv metadata for a paper id and persists a Paper in the
// `discovered` state. arXiv is the only source in MVP (config.yaml, tech-spec).

import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "@paperlens/db/schema/index";

/**
 * A Drizzle SQLite database carrying the PaperLens schema. Both the production
 * D1 binding (`drizzle-orm/d1`) and the in-memory `bun:sqlite` used in tests
 * satisfy this — they share the SQLite dialect — so the crawler is agnostic to
 * which one it is handed.
 */
export type CrawlerDb = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema>;

/**
 * The HTTP fetcher the crawler uses to reach the arXiv API. Injected so tests
 * supply a fixture response and no real network call is ever made. Defaults to
 * the global `fetch` in production.
 */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/** Metadata parsed from an arXiv API (Atom) entry for a single paper. */
export interface ArxivMetadata {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  sourceUrl: string;
  fullTextUrl: string;
  pdfUrl: string;
}
