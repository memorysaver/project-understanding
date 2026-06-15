import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { posts } from "@paperlens/db/schema/paperlens";
import { publicProcedure } from "../index";

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
