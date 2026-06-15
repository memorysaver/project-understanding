// @paperlens/digestor — the digestor pipeline stage (PL-004).
//
// For a discovered Paper it fetches the full text (arXiv HTML source, abstract
// fallback) and asks the LLM for a structured Digest (contributions / methods /
// results), then persists the Digest and advances the Paper to `digested` in a
// single transaction. On LLM failure it rethrows (so the orchestrator/queue can
// retry) and leaves the Paper at `discovered` — no partial advance.
//
// The full-text fetcher and the llm client are injected so tests are
// deterministic and offline. See docs/technical-spec.md §3 (Paper state machine)
// and openspec/specs/llm-gateway.
import type { DigestContent } from "./digest-schema";
import type { FullTextFetcher } from "./full-text";
import type { digestSchema as DigestSchema } from "./digest-schema";
import type { CompleteJsonResult } from "@paperlens/llm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { papers, digests } from "@paperlens/db/schema/paperlens";
import { complete as defaultComplete } from "@paperlens/llm";
import { eq } from "drizzle-orm";
import { digestSchema } from "./digest-schema";
import { fetchArxivFullText } from "./full-text";

export { digestSchema, type DigestContent } from "./digest-schema";
export { fetchArxivFullText, type FullTextFetcher, type Paper } from "./full-text";

/**
 * The schema-bound shape of `llm.complete` the digestor consumes. Injectable so
 * tests pass a mock; defaults to the real `@paperlens/llm` client.
 */
export type DigestComplete = (args: {
  stage: "digest";
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  schema: typeof DigestSchema;
}) => Promise<CompleteJsonResult<DigestContent>>;

// Both Cloudflare D1 (async) and bun-sqlite (sync, used in tests) satisfy this.
type Db = BaseSQLiteDatabase<"sync" | "async", unknown, Record<string, unknown>>;

export type DigestorRunArgs = {
  /** arXiv id of the Paper to digest (papers.arxivId / digests.paperId). */
  paperId: string;
  db: Db;
  /** Injected full-text fetcher; defaults to the arXiv HTML/abstract fetcher. */
  fetchFullText?: FullTextFetcher;
  /** Injected llm client; defaults to the real `@paperlens/llm` complete. */
  complete?: DigestComplete;
};

const SYSTEM_PROMPT =
  "You are a meticulous research editor. Read the paper text and extract its key " +
  "contributions, methods, and results as short, faithful bullet points. Only " +
  "include claims supported by the text; do not invent or extrapolate.";

// Appended when only the abstract is available (full text could not be fetched).
// Without it the model invents specific quantitative results — benchmark scores,
// comparison tables, baselines — absent from the abstract, the dominant
// abstract-only faithfulness defect found by the L0 gate (PL-030).
const ABSTRACT_ONLY_GUARD =
  "\n\nIMPORTANT: Only the paper's ABSTRACT is available — the full text could not " +
  "be retrieved. Extract ONLY what the abstract explicitly states. Do NOT invent or " +
  "infer any specific number, benchmark score, dataset size, baseline name, or " +
  "comparison the abstract does not contain. If the abstract gives no quantitative " +
  "results, keep the results bullets qualitative.";

function buildMessages(paper: { title: string }, fullText: string, abstractOnly: boolean) {
  const label = abstractOnly ? "Abstract (full text unavailable)" : "Full text";
  return [
    {
      role: "system" as const,
      content: abstractOnly ? SYSTEM_PROMPT + ABSTRACT_ONLY_GUARD : SYSTEM_PROMPT,
    },
    {
      role: "user" as const,
      content: `Title: ${paper.title}\n\n${label}:\n${fullText}`,
    },
  ];
}

/**
 * Run the digestor for one Paper. Returns the persisted Digest row.
 *
 * Acceptance criteria:
 *  1. Produces a Digest with contributions, methods, and results from full text.
 *  2. The Digest is persisted and the Paper advances to status `digested`.
 *  3. On LLM failure it throws (for retry) and leaves the Paper at `discovered`
 *     — no Digest is written and the status is not advanced.
 */
export async function run(args: DigestorRunArgs) {
  const { paperId, db } = args;
  const complete = args.complete ?? (defaultComplete as DigestComplete);
  const fetchFullText = args.fetchFullText ?? fetchArxivFullText;

  const paper = (await db.select().from(papers).where(eq(papers.arxivId, paperId)))[0];
  if (!paper) {
    throw new Error(`Paper not found: ${paperId}`);
  }

  const fullText = await fetchFullText(paper);
  // The default fetcher returns the stored abstract verbatim when no full text is
  // available; detect that so we can forbid inventing specifics absent from the
  // abstract (PL-030).
  const abstractOnly = fullText.trim() === paper.abstract.trim();

  // If the LLM call fails it throws here, before any write — the transaction
  // below never starts, so the Paper stays at `discovered` (criterion 3).
  const { json, model } = await complete({
    stage: "digest",
    messages: buildMessages(paper, fullText, abstractOnly),
    schema: digestSchema,
  });

  return db.transaction(async (tx) => {
    const digest = (
      await tx
        .insert(digests)
        .values({
          paperId,
          contributions: json.contributions,
          methods: json.methods,
          results: json.results,
          rawJson: json,
          model,
        })
        .returning()
    )[0]!;

    await tx.update(papers).set({ status: "digested" }).where(eq(papers.arxivId, paperId));

    return digest;
  });
}
