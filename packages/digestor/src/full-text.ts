import type { papers } from "@paperlens/db/schema/paperlens";
import type { InferSelectModel } from "drizzle-orm";

export type Paper = InferSelectModel<typeof papers>;

/**
 * Fetches the full text to digest for a paper. Injected into `run` so tests use
 * a fixture and never touch the network.
 *
 * The MVP prefers the arXiv HTML source and falls back to the abstract; full-PDF
 * binary parsing is out of scope (it must not run inside a Worker).
 */
export type FullTextFetcher = (paper: Paper) => Promise<string>;

const HTML_TAG = /<[^>]+>/g;
const WHITESPACE = /\s+/g;

function htmlToText(html: string): string {
  return html.replace(HTML_TAG, " ").replace(WHITESPACE, " ").trim();
}

/**
 * Default fetcher: prefer the arXiv HTML source (`fullTextUrl`), falling back to
 * the stored abstract when no HTML source is available or the fetch fails. PDF
 * binary extraction is deliberately not attempted here.
 */
export const fetchArxivFullText: FullTextFetcher = async (paper) => {
  if (paper.fullTextUrl) {
    try {
      const res = await fetch(paper.fullTextUrl);
      if (res.ok) {
        const text = htmlToText(await res.text());
        if (text) return text;
      }
    } catch {
      // fall through to the abstract fallback
    }
  }
  return paper.abstract;
};
