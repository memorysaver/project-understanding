import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { posts } from "@paperlens/db/schema/paperlens";
import { protectedProcedure, publicProcedure } from "../index";

// Public reader API (PL-008). These procedures expose ONLY published posts and
// must never leak draft/unpublished rows, so every query is constrained to
// status = "published".
const PUBLISHED = eq(posts.status, "published");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// A published post is guaranteed a non-null published_at (db invariant), but the
// column is nullable at the type level; coalesce defensively for ordering.
const publishedSort = desc(posts.publishedAt);

// listPosts — published posts, newest first, paginated. Public; no auth.
export const listPosts = publicProcedure
  .input(
    z
      .object({
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
        offset: z.number().int().min(0).default(0),
      })
      .optional(),
  )
  .handler(async ({ context, input }) => {
    const limit = input?.limit ?? DEFAULT_LIMIT;
    const offset = input?.offset ?? 0;

    const items = await context.db
      .select()
      .from(posts)
      .where(PUBLISHED)
      .orderBy(publishedSort)
      .limit(limit)
      .offset(offset);

    return {
      items,
      limit,
      offset,
    };
  });

// getPost — one published post by id, or NOT_FOUND for unpublished/missing.
// Unpublished and missing collapse to the same not-found response so the API
// never reveals that an unpublished post exists. Public; no auth.
export const getPost = publicProcedure
  .input(z.object({ id: z.string().min(1) }))
  .handler(async ({ context, input }) => {
    const [post] = await context.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, input.id), PUBLISHED))
      .limit(1);

    if (!post) {
      throw new ORPCError("NOT_FOUND");
    }

    return post;
  });

// Console (auth-gated) post curation (PL-021). The owner toggles a post between
// `published` and `unpublished` (and may edit its body) — the safety net for a
// bad post. Composes on protectedProcedure (PL-014): an unauthenticated call is
// rejected with 401 before the handler runs, so no post is read or mutated.
//
// Moving to `unpublished` removes the post from the public feed; moving back to
// `published` restores it — the reader feed (PL-008) already filters on
// status = "published", so the status flip alone satisfies that requirement.
// The console may not set `draft` (owned by the pipeline) — the input enum
// accepts only published/unpublished.
//
// body is `.optional()` (not `.default(...)`) per the Zod v4 quirk; when absent
// it is simply omitted from the update.
export const setPostStatus = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1),
      status: z.enum(["published", "unpublished"]),
      body: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    const [updated] = await context.db
      .update(posts)
      .set({
        status: input.status,
        // Only touch body when supplied (.optional() input, not a default).
        ...(input.body !== undefined ? { body: input.body } : {}),
        // Republishing a post whose published_at is null must set published_at
        // so the PL-006 invariant (a published post has a non-null
        // published_at) holds; coalesce keeps an already-published post's
        // original timestamp. Unpublishing leaves published_at as-is.
        ...(input.status === "published"
          ? { publishedAt: sql`coalesce(${posts.publishedAt}, ${Date.now()})` }
          : {}),
      })
      .where(eq(posts.id, input.id))
      .returning();

    if (!updated) {
      throw new ORPCError("NOT_FOUND");
    }

    return updated;
  });
