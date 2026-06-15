// arXiv API client + Atom parser for the discovery stage.
//
// We query the arXiv export API (export.arxiv.org/api/query?id_list=<id>),
// which returns an Atom feed. A single <entry> is parsed into ArxivMetadata.
// Source/full-text/pdf URLs are derived from the canonical id so they are
// stable regardless of which <link> elements the feed happens to include:
//   source_url    -> https://arxiv.org/abs/<id>   (abstract page)
//   full_text_url -> https://arxiv.org/html/<id>  (HTML rendering, preferred
//                     for full-text digestion per the product decisions)
//   pdf_url       -> https://arxiv.org/pdf/<id>
//
// No XML library is used — the Atom feed is small and regular, so a few scoped
// regexes keep the package dependency-free. Entities in text fields are decoded.

import type { ArxivMetadata, FetchLike } from "./types";

export const ARXIV_API_BASE = "https://export.arxiv.org/api/query";

// A descriptive User-Agent is required by arXiv's API etiquette so they can
// contact the operator; it is sent on every request.
export const USER_AGENT =
  "PaperLens/0.1 (+https://github.com/memorysaver/project-understanding; crawler)";

/** arXiv asks API clients to wait ~3s between calls. Exposed for the caller. */
export const ARXIV_MIN_INTERVAL_MS = 3000;

export class ArxivError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ArxivError";
  }
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m);
}

/** Collapse the whitespace arXiv inserts into wrapped title/summary text. */
function normalizeText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function firstMatch(source: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(source);
  return match?.[1];
}

/**
 * Parse the first <entry> of an arXiv Atom feed into ArxivMetadata for `id`.
 * Throws ArxivError if no usable entry is present (e.g. unknown id) or required
 * fields are missing.
 */
export function parseArxivAtom(xml: string, id: string): ArxivMetadata {
  const entry = firstMatch(xml, /<entry>([\s\S]*?)<\/entry>/);
  if (!entry) {
    throw new ArxivError(`arXiv returned no entry for id "${id}"`);
  }

  const title = firstMatch(entry, /<title>([\s\S]*?)<\/title>/);
  const summary = firstMatch(entry, /<summary>([\s\S]*?)<\/summary>/);
  if (!title || !summary) {
    throw new ArxivError(`arXiv entry for id "${id}" is missing title or summary`);
  }

  const authors: string[] = [];
  const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
  let authorMatch: RegExpExecArray | null;
  while ((authorMatch = authorRe.exec(entry)) !== null) {
    const name = normalizeText(authorMatch[1] ?? "");
    if (name) authors.push(name);
  }
  if (authors.length === 0) {
    throw new ArxivError(`arXiv entry for id "${id}" has no authors`);
  }

  return {
    arxivId: id,
    title: normalizeText(title),
    authors,
    abstract: normalizeText(summary),
    sourceUrl: `https://arxiv.org/abs/${id}`,
    fullTextUrl: `https://arxiv.org/html/${id}`,
    pdfUrl: `https://arxiv.org/pdf/${id}`,
  };
}

/**
 * Fetch metadata for a single arXiv id via the API, using the injected fetcher
 * (so tests can supply a fixture without touching the network) and sending the
 * required custom User-Agent. Returns parsed ArxivMetadata.
 */
export async function fetchArxivMetadata(id: string, fetcher: FetchLike): Promise<ArxivMetadata> {
  const url = `${ARXIV_API_BASE}?id_list=${encodeURIComponent(id)}`;
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetcher(url, { headers: { "User-Agent": USER_AGENT } });
  } catch (cause) {
    throw new ArxivError(`arXiv request failed for id "${id}"`, { cause });
  }
  if (!response.ok) {
    throw new ArxivError(`arXiv request for id "${id}" returned status ${response.status}`);
  }
  const xml = await response.text();
  return parseArxivAtom(xml, id);
}
