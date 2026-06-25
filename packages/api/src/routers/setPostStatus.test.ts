/// <reference types="bun" />
import { expect, test, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { call, ORPCError } from "@orpc/server";
import * as schema from "@paperlens/db/schema/paperlens";
import { getPost, listPosts, setPostStatus } from "./posts";
import type { Context, Db } from "../context";

// In-memory SQLite with the real D1 migration applied — same dialect and schema
// as production, no Cloudflare binding or network. Mirrors posts.test.ts.
async function makeDb(): Promise<BunSQLiteDatabase<typeof schema>> {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  const url = new URL("../../../db/src/migrations/0000_keen_supernaut.sql", import.meta.url);
  const migration = await Bun.file(url).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.run(trimmed);
  }
  return drizzle(sqlite, { schema });
}

// Inject the oRPC context (db + session) directly — never the prod createContext
// (which reads Cloudflare bindings). null session = unauthenticated; an object
// with a truthy `user` = an authenticated owner. Mirrors prompt.test.ts.
function ctx(session: Context["session"], db: BunSQLiteDatabase<typeof schema>): Context {
  return { auth: null, session, db: db as unknown as Db };
}

function ownerSession(): Context["session"] {
  return {
    session: { id: "sess-1", userId: "owner-1" },
    user: { id: "owner-1", email: "owner@example.com" },
  } as unknown as Context["session"];
}

// Insert a post with its required FK parents (paper -> digest -> style prompt).
// `n` makes the arxiv id / digest unique per call. Mirrors posts.test.ts.
async function insertPost(
  db: BunSQLiteDatabase<typeof schema>,
  n: number,
  fields: {
    id: string;
    status: "draft" | "unpublished" | "published";
    publishedAt: Date | null;
  },
): Promise<void> {
  const arxivId = `2401.${String(n).padStart(5, "0")}`;
  await db.insert(schema.papers).values({
    arxivId,
    title: `paper ${n}`,
    authors: ["Author"],
    abstract: "abs",
    sourceUrl: `https://arxiv.org/abs/${arxivId}`,
  });
  const digest = (
    await db
      .insert(schema.digests)
      .values({
        paperId: arxivId,
        contributions: ["c"],
        methods: ["m"],
        results: ["r"],
        model: "test-model",
      })
      .returning()
  )[0]!;
  const prompt = (
    await db.insert(schema.stylePrompts).values({ content: "voice", isActive: false }).returning()
  )[0]!;
  await db.insert(schema.posts).values({
    id: fields.id,
    paperId: arxivId,
    digestId: digest.id,
    stylePromptId: prompt.id,
    title: `title ${n}`,
    body: "body",
    citation: "cite",
    status: fields.status,
    publishedAt: fields.publishedAt,
    model: "test-model",
  });
}

function getRow(db: BunSQLiteDatabase<typeof schema>, id: string) {
  return db
    .select()
    .from(schema.posts)
    .where(eq(schema.posts.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

let db: BunSQLiteDatabase<typeof schema>;

beforeEach(async () => {
  db = await makeDb();
  // One published post (with a published_at) and one unpublished post.
  await insertPost(db, 1, {
    id: "p-pub",
    status: "published",
    publishedAt: new Date("2024-01-01T00:00:00Z"),
  });
  await insertPost(db, 2, {
    id: "p-unpub",
    status: "unpublished",
    publishedAt: null,
  });
});

describe("PL-021 setPostStatus — status toggle", () => {
  // Task 4.1: flip published -> unpublished -> published, asserting each step.
  test("flips a post from published to unpublished and back", async () => {
    const down = await call(
      setPostStatus,
      { id: "p-pub", status: "unpublished" },
      { context: ctx(ownerSession(), db) },
    );
    expect(down.status).toBe("unpublished");
    expect((await getRow(db, "p-pub"))!.status).toBe("unpublished");

    const up = await call(
      setPostStatus,
      { id: "p-pub", status: "published" },
      { context: ctx(ownerSession(), db) },
    );
    expect(up.status).toBe("published");
    expect((await getRow(db, "p-pub"))!.status).toBe("published");
  });

  // Task 4.1 + PL-006 invariant: republishing a post whose published_at is null
  // sets a non-null published_at.
  test("republishing an unpublished post sets a non-null published_at", async () => {
    expect((await getRow(db, "p-unpub"))!.publishedAt).toBeNull();

    const up = await call(
      setPostStatus,
      { id: "p-unpub", status: "published" },
      { context: ctx(ownerSession(), db) },
    );

    expect(up.status).toBe("published");
    expect(up.publishedAt).not.toBeNull();
    expect((await getRow(db, "p-unpub"))!.publishedAt).not.toBeNull();
  });

  // Unpublishing preserves the existing published_at; republishing keeps the
  // original timestamp (coalesce — does not overwrite an already-published post).
  test("preserves the original published_at across unpublish + republish", async () => {
    const original = (await getRow(db, "p-pub"))!.publishedAt;
    expect(original).not.toBeNull();

    await call(
      setPostStatus,
      { id: "p-pub", status: "unpublished" },
      { context: ctx(ownerSession(), db) },
    );
    expect((await getRow(db, "p-pub"))!.publishedAt?.getTime()).toBe(original!.getTime());

    await call(
      setPostStatus,
      { id: "p-pub", status: "published" },
      { context: ctx(ownerSession(), db) },
    );
    expect((await getRow(db, "p-pub"))!.publishedAt?.getTime()).toBe(original!.getTime());
  });

  // Optional body edit is persisted alongside the status flip.
  test("optionally edits the post body", async () => {
    const result = await call(
      setPostStatus,
      { id: "p-pub", status: "published", body: "edited body" },
      { context: ctx(ownerSession(), db) },
    );
    expect(result.body).toBe("edited body");
    expect((await getRow(db, "p-pub"))!.body).toBe("edited body");
  });

  // A missing id fails cleanly with NOT_FOUND rather than silently no-op'ing.
  test("throws NOT_FOUND for a missing post id", async () => {
    await expect(
      call(
        setPostStatus,
        { id: "does-not-exist", status: "unpublished" },
        { context: ctx(ownerSession(), db) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // The console may not set `draft` (pipeline-owned) — the input enum rejects it.
  test("rejects a draft status (enum only allows published/unpublished)", async () => {
    await expect(
      call(
        setPostStatus,
        { id: "p-pub", status: "draft" as "published" },
        { context: ctx(ownerSession(), db) },
      ),
    ).rejects.toBeDefined();
  });
});

describe("PL-021 setPostStatus — auth gate", () => {
  // Task 4.2: unauthenticated call -> 401 and the post is not mutated.
  test("without a session throws 401 (UNAUTHORIZED) and does not mutate", async () => {
    let thrown: unknown;
    try {
      await call(setPostStatus, { id: "p-pub", status: "unpublished" }, { context: ctx(null, db) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ORPCError);
    const err = thrown as ORPCError<string, unknown>;
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.status).toBe(401);

    // The post is untouched.
    expect((await getRow(db, "p-pub"))!.status).toBe("published");
  });
});

describe("PL-021 setPostStatus — feed integration (PL-008 readers)", () => {
  // Task 4.3: after unpublishing, the post disappears from listPosts and getPost
  // returns NOT_FOUND; after republishing, it reappears. Driven through the real
  // reader procedures on the shared db.
  test("unpublished post is hidden from listPosts / getPost, then restored", async () => {
    // Baseline: the published post is in the feed.
    let feed = await call(listPosts, {}, { context: ctx(null, db) });
    expect(feed.items.map((p) => p.id)).toContain("p-pub");

    // Unpublish it (owner).
    await call(
      setPostStatus,
      { id: "p-pub", status: "unpublished" },
      { context: ctx(ownerSession(), db) },
    );

    feed = await call(listPosts, {}, { context: ctx(null, db) });
    expect(feed.items.map((p) => p.id)).not.toContain("p-pub");
    await expect(call(getPost, { id: "p-pub" }, { context: ctx(null, db) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // Republish it.
    await call(
      setPostStatus,
      { id: "p-pub", status: "published" },
      { context: ctx(ownerSession(), db) },
    );

    feed = await call(listPosts, {}, { context: ctx(null, db) });
    expect(feed.items.map((p) => p.id)).toContain("p-pub");
    const post = await call(getPost, { id: "p-pub" }, { context: ctx(null, db) });
    expect(post.id).toBe("p-pub");
  });
});
