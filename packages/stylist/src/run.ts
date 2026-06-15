import { and, desc, eq } from "drizzle-orm";
import { digests, papers, stylePrompts } from "@paperlens/db/schema/paperlens";
import type { complete } from "@paperlens/llm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

// The stylist needs only the active StylePrompt, the paper's Digest, and the
// papers/style_prompts/digests tables — so a structurally-typed db handle keeps
// it usable with both the real D1 binding and the in-memory test database.
type Db = BaseSQLiteDatabase<"sync" | "async", unknown, Record<string, unknown>>;

/** Just the `complete` text path of `@paperlens/llm`, injected so tests run offline. */
type Complete = typeof complete;

/** Dependencies injected into the stylist so it can run against a mocked llm. */
export type StylistDeps = {
  db: Db;
  complete: Complete;
};

/** Arguments to `run`: which paper to style. */
export type RunArgs = {
  paperId: string;
};

/** Result of a successful styling run. */
export type StylistResult = {
  paperId: string;
  body: string;
  stylePromptId: string;
  digestId: string;
  model: string;
};

/**
 * Rewrite a paper's Digest into a styled post body using the active StylePrompt
 * as the voice, then advance the Paper to status `styled`.
 *
 * Loads the single active (default) StylePrompt and the paper's latest Digest,
 * passes the prompt text as the system/style instruction to `complete` (stage
 * `style`), and returns the styled body. On success the Paper status advances to
 * `styled`. The llm `complete` is injected so tests never hit the network.
 */
export async function run(
  { db, complete }: StylistDeps,
  { paperId }: RunArgs,
): Promise<StylistResult> {
  const prompt = (
    await db.select().from(stylePrompts).where(eq(stylePrompts.isActive, true)).limit(1)
  )[0];
  if (!prompt) {
    throw new Error("stylist: no active StylePrompt found");
  }

  const digest = (
    await db
      .select()
      .from(digests)
      .where(eq(digests.paperId, paperId))
      .orderBy(desc(digests.createdAt))
      .limit(1)
  )[0];
  if (!digest) {
    throw new Error(`stylist: no digest found for paper ${paperId}`);
  }

  const { content: rawBody, model } = await complete({
    stage: "style",
    messages: [
      { role: "system", content: prompt.content + BODY_GUARD },
      { role: "user", content: renderDigest(digest) },
    ],
  });

  if (rawBody.trim().length === 0) {
    throw new Error(`stylist: llm returned an empty styled body for paper ${paperId}`);
  }

  // Strip any citation footer the model invented; the real one is added from
  // verified Paper metadata by the publisher (PL-029).
  const body = stripFabricatedCitation(rawBody);

  await db
    .update(papers)
    .set({ status: "styled" })
    .where(and(eq(papers.arxivId, paperId), eq(papers.status, "digested")));

  return { paperId, body, stylePromptId: prompt.id, digestId: digest.id, model };
}

/**
 * Appended to the active StylePrompt. The body must never carry bibliographic
 * metadata, which the model otherwise hallucinates — placeholder/wrong arXiv ids
 * (e.g. 2505.XXXXX), wrong or thesis-inverting titles, fake affiliations. The
 * real citation + source link are attached separately from verified Paper
 * metadata by the publisher (PL-029).
 */
const BODY_GUARD =
  "\n\nIMPORTANT: Write ONLY the article body. Do NOT include any citation, a " +
  "references/bibliography section, the paper's arXiv id or DOI, author " +
  "affiliations, or an 'Original paper' / 'Read the paper' link or footer — those " +
  "are attached separately from verified metadata. Never invent or guess an arXiv " +
  "id, a paper title, an author, or an affiliation.";

/**
 * Remove a trailing citation/reference footer the stylist may have invented.
 * Walks back from the end over blank lines, horizontal rules, and citation-like
 * lines (arXiv id/link, DOI, "Original paper"/"Read the paper", "Paper:", etc.),
 * stopping at the first real content line. The real citation is built from
 * verified Paper metadata elsewhere (publisher.buildCitation). PL-029.
 */
export function stripFabricatedCitation(body: string): string {
  const citationLine =
    /(arxiv\s*:|arxiv\.org|doi\s*:|original paper|read the (full )?paper|^\s*\**\s*(papers?|sources?|references?|citations?)\s*:|\b\d{4}\.\d{4,5}(v\d+)?\b|\b[xX]{4,5}\b)/i;
  const lines = body.replace(/\s+$/, "").split("\n");
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1]!.trim();
    if (line === "" || /^[*_]{0,2}-{3,}[*_]{0,2}$/.test(line) || citationLine.test(line)) {
      end--;
    } else {
      break;
    }
  }
  return lines.slice(0, end).join("\n").trimEnd();
}

/** Render a Digest's structured fields into the user message the stylist styles. */
function renderDigest(digest: {
  contributions: string[];
  methods: string[];
  results: string[];
}): string {
  const section = (label: string, items: string[]) =>
    `${label}:\n${items.map((i) => `- ${i}`).join("\n")}`;
  return [
    section("Contributions", digest.contributions),
    section("Methods", digest.methods),
    section("Results", digest.results),
  ].join("\n\n");
}
