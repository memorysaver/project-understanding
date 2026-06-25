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
 * Map one <entry> body to ArxivMetadata for `id`, or return null if a required
 * field (title, summary, or any author) is missing. Shared by `parseArxivAtom`
 * (which throws on null) and `parseArxivBatch` (which skips it). The three URLs
 * are derived from the canonical id.
 */
function parseEntry(entry: string, id: string): ArxivMetadata | null {
  const title = firstMatch(entry, /<title>([\s\S]*?)<\/title>/);
  const summary = firstMatch(entry, /<summary>([\s\S]*?)<\/summary>/);
  if (!title || !summary) {
    return null;
  }

  const authors: string[] = [];
  const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
  let authorMatch: RegExpExecArray | null;
  while ((authorMatch = authorRe.exec(entry)) !== null) {
    const name = normalizeText(authorMatch[1] ?? "");
    if (name) authors.push(name);
  }
  if (authors.length === 0) {
    return null;
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
 * Extract the canonical arXiv id from an entry's <id> element, dropping the
 * `http(s)://arxiv.org/abs/` prefix and the trailing version (`v1`, `v2`, …) so
 * the id matches the dedup key. Returns undefined if no <id> is present.
 */
function entryArxivId(entry: string): string | undefined {
  const raw = firstMatch(entry, /<id>([\s\S]*?)<\/id>/);
  if (!raw) return undefined;
  return raw
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/abs\//, "")
    .replace(/v\d+$/, "");
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

  const metadata = parseEntry(entry, id);
  if (!metadata) {
    throw new ArxivError(`arXiv entry for id "${id}" is missing title, summary, or authors`);
  }
  return metadata;
}

/**
 * Parse every <entry> of an arXiv list feed into ArxivMetadata, deriving each
 * paper's id from its own <entry> <id> (the list feed returns recent
 * submissions, not a known id). A malformed entry — missing <id> or a required
 * field — is skipped rather than thrown, so one bad entry does not fail the
 * whole batch. An empty feed yields an empty array.
 */
export function parseArxivBatch(xml: string): ArxivMetadata[] {
  const results: ArxivMetadata[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch: RegExpExecArray | null;
  while ((entryMatch = entryRe.exec(xml)) !== null) {
    const entry = entryMatch[1] ?? "";
    const id = entryArxivId(entry);
    if (!id) continue;
    const metadata = parseEntry(entry, id);
    if (metadata) results.push(metadata);
  }
  return results;
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

/**
 * Fetch the raw Atom body for a batch of recent papers via the arXiv list
 * endpoint (`search_query=...&sortBy=submittedDate&sortOrder=descending&max_results=N`),
 * using the injected fetcher and the required custom User-Agent. Returns the
 * Atom XML, which `parseArxivBatch` turns into per-paper metadata. This reuses
 * the same API base, User-Agent, and error surface as `fetchArxivMetadata` — the
 * only difference is the list query instead of `id_list=<one id>`.
 */
export async function fetchArxivBatch(
  query: string,
  maxResults: number,
  fetcher: FetchLike,
): Promise<string> {
  const url =
    `${ARXIV_API_BASE}?search_query=${encodeURIComponent(query)}` +
    `&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetcher(url, { headers: { "User-Agent": USER_AGENT } });
  } catch (cause) {
    throw new ArxivError(`arXiv batch request failed for query "${query}"`, { cause });
  }
  if (!response.ok) {
    throw new ArxivError(
      `arXiv batch request for query "${query}" returned status ${response.status}`,
    );
  }
  return response.text();
}
