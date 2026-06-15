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
    await db
      .select()
      .from(stylePrompts)
      .where(eq(stylePrompts.isActive, true))
      .limit(1)
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

  const { content: body, model } = await complete({
    stage: "style",
    messages: [
      { role: "system", content: prompt.content },
      { role: "user", content: renderDigest(digest) },
    ],
  });

  if (body.trim().length === 0) {
    throw new Error(`stylist: llm returned an empty styled body for paper ${paperId}`);
  }

  await db
    .update(papers)
    .set({ status: "styled" })
    .where(and(eq(papers.arxivId, paperId), eq(papers.status, "digested")));

  return { paperId, body, stylePromptId: prompt.id, digestId: digest.id, model };
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
