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

// arXiv's HTML (ar5iv) wraps the paper in page chrome — a theme <script>, a ToC
// <nav>, the document <head>, headers/footers. Stripping only tags leaves the
// script/style *bodies* and ToC text in the output, which pollutes the digest
// and wastes tokens. Remove those blocks (content included) before stripping the
// remaining tags.
const SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const STYLE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const CHROME = /<(head|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAG = /<[^>]+>/g;
const WHITESPACE = /\s+/g;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};
const ENTITY = /&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g;

function htmlToText(html: string): string {
  return html
    .replace(SCRIPT, " ")
    .replace(STYLE, " ")
    .replace(COMMENT, " ")
    .replace(CHROME, " ")
    .replace(HTML_TAG, " ")
    .replace(ENTITY, (e) => ENTITIES[e]!)
    .replace(WHITESPACE, " ")
    .trim();
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
