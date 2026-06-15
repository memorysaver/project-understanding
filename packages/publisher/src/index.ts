// @paperlens/publisher — the publisher stage of the PaperLens pipeline.
//
// From a styled body it assembles and persists a published `Post` (title,
// sanitized body, citation built from the source Paper, and a link back to the
// paper), advances the source Paper to `published`, and stamps `published_at`.
// See docs/technical-spec.md §2 (Post invariant) and product-context.yaml
// (publisher stage). This is story PL-006.
import { eq } from "drizzle-orm";
import { papers, posts } from "@paperlens/db/schema/paperlens";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { buildCitation } from "./citation";
import { sanitizeBody } from "./sanitize";

export { buildCitation } from "./citation";
export { sanitizeBody } from "./sanitize";

// Accepts any Drizzle SQLite database (the production D1 binding and the
// in-memory bun-sqlite test db are both compatible).
type Db = BaseSQLiteDatabase<"sync" | "async", unknown, Record<string, unknown>>;

/** Arguments to `publish`. */
export type PublishArgs = {
  /** arXiv id of the source Paper (also the Post's `paperId`). */
  paperId: string;
  /** The Digest the post was produced from. */
  digestId: string;
  /** The active StylePrompt used to style the body. */
  stylePromptId: string;
  /** Headline for the post. */
  title: string;
  /** The stylist's (untrusted) styled body; sanitized before storage. */
  styledBody: string;
  /** Model id that produced the styled body, recorded on the Post. */
  model: string;
};

/** A fully populated, persisted published Post. */
export type PublishedPost = typeof posts.$inferSelect;

/**
 * Assemble and persist a published `Post` from a styled body.
 *
 * Sanitizes the styled body, builds the citation (with the link back to the
 * source paper) from the Paper's metadata, inserts the Post with
 * `status = "published"` and a non-null `published_at`, and advances the source
 * Paper to `status = "published"`. The insert and the Paper update run in one
 * transaction so the two never diverge. No tags are set at Layer 0.
 *
 * Throws if the source Paper does not exist.
 */
export async function publish(db: Db, args: PublishArgs): Promise<PublishedPost> {
  const paper = (await db.select().from(papers).where(eq(papers.arxivId, args.paperId)))[0];
  if (!paper) {
    throw new Error(`publish: source paper not found: ${args.paperId}`);
  }

  const body = sanitizeBody(args.styledBody);
  const citation = buildCitation({
    arxivId: paper.arxivId,
    title: paper.title,
    authors: paper.authors,
    sourceUrl: paper.sourceUrl,
  });
  const publishedAt = new Date();

  return db.transaction(async (tx) => {
    const post = (
      await tx
        .insert(posts)
        .values({
          paperId: args.paperId,
          digestId: args.digestId,
          stylePromptId: args.stylePromptId,
          title: args.title,
          body,
          citation,
          status: "published",
          publishedAt,
          model: args.model,
        })
        .returning()
    )[0];

    await tx.update(papers).set({ status: "published" }).where(eq(papers.arxivId, args.paperId));

    return post!;
  });
}
