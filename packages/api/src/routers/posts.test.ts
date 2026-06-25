/// <reference types="bun" />
import { expect, test, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { call, ORPCError } from "@orpc/server";
import * as schema from "@paperlens/db/schema/paperlens";
import { getPost, listPosts } from "./posts";
import type { Db } from "../context";

// In-memory SQLite with the real D1 migration applied — same dialect and schema
// as production, no Cloudflare binding or network. Mirrors packages/db tests.
async function makeDb(): Promise<BunSQLiteDatabase<typeof schema>> {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  for (const file of ["0000_keen_supernaut.sql", "0001_far_edwin_jarvis.sql"]) {
    const url = new URL(`../../../db/src/migrations/${file}`, import.meta.url);
    const migration = await Bun.file(url).text();
    for (const statement of migration.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.run(trimmed);
    }
  }
  return drizzle(sqlite, { schema });
}

// Build the public context shape the routers read. session/auth are unused by
// these public procedures; only db is exercised.
function ctx(db: BunSQLiteDatabase<typeof schema>) {
  return { auth: null, session: null, db: db as unknown as Db };
}

// Insert a post with its required FK parents (paper -> digest -> style prompt).
// `n` makes the arxiv id / digest unique per call.
async function insertPost(
  db: BunSQLiteDatabase<typeof schema>,
  n: number,
  fields: {
    id: string;
    title: string;
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
    await db
      .insert(schema.stylePrompts)
      .values({ content: "voice", isActive: false })
      .returning()
  )[0]!;
  await db.insert(schema.posts).values({
    id: fields.id,
    paperId: arxivId,
    digestId: digest.id,
    stylePromptId: prompt.id,
    title: fields.title,
    body: "body",
    citation: "cite",
    status: fields.status,
    publishedAt: fields.publishedAt,
    model: "test-model",
  });
}

let db: BunSQLiteDatabase<typeof schema>;

// Seed a mix: 3 published (out-of-order published_at), 1 unpublished, 1 draft.
beforeEach(async () => {
  db = await makeDb();
  await insertPost(db, 1, {
    id: "pub-old",
    title: "Oldest published",
    status: "published",
    publishedAt: new Date("2024-01-01T00:00:00Z"),
  });
  await insertPost(db, 2, {
    id: "pub-new",
    title: "Newest published",
    status: "published",
    publishedAt: new Date("2024-03-01T00:00:00Z"),
  });
  await insertPost(db, 3, {
    id: "pub-mid",
    title: "Middle published",
    status: "published",
    publishedAt: new Date("2024-02-01T00:00:00Z"),
  });
  await insertPost(db, 4, {
    id: "unpub-1",
    title: "Hidden unpublished",
    status: "unpublished",
    publishedAt: null,
  });
  await insertPost(db, 5, {
    id: "draft-1",
    title: "Hidden draft",
    status: "draft",
    publishedAt: null,
  });
});

describe("PL-008 listPosts", () => {
  // AC1 + no-leak invariant: only published rows are ever returned.
  test("returns only published posts — unpublished and draft never leak", async () => {
    const { items } = await call(listPosts, {}, { context: ctx(db) });
    const ids = items.map((p) => p.id);

    expect(items).toHaveLength(3);
    expect(ids).not.toContain("unpub-1");
    expect(ids).not.toContain("draft-1");
    for (const p of items) {
      expect(p.status).toBe("published");
    }
  });

  // AC1: newest first (published_at descending).
  test("orders published posts newest first", async () => {
    const { items } = await call(listPosts, {}, { context: ctx(db) });
    expect(items.map((p) => p.id)).toEqual(["pub-new", "pub-mid", "pub-old"]);
  });

  // AC1: pagination via limit/offset, still published-only and ordered.
  test("paginates with limit and offset", async () => {
    const page1 = await call(listPosts, { limit: 2, offset: 0 }, { context: ctx(db) });
    expect(page1.items.map((p) => p.id)).toEqual(["pub-new", "pub-mid"]);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);

    const page2 = await call(listPosts, { limit: 2, offset: 2 }, { context: ctx(db) });
    expect(page2.items.map((p) => p.id)).toEqual(["pub-old"]);
  });

  // Contract: default input yields the documented response shape.
  test("response has the listPosts contract shape", async () => {
    const res = await call(listPosts, {}, { context: ctx(db) });
    expect(res).toHaveProperty("items");
    expect(res).toHaveProperty("limit", 20);
    expect(res).toHaveProperty("offset", 0);
    expect(Array.isArray(res.items)).toBe(true);
  });

  // Contract: invalid pagination input is rejected by the procedure schema.
  test("rejects invalid pagination input", async () => {
    await expect(call(listPosts, { limit: 0 }, { context: ctx(db) })).rejects.toThrow();
    await expect(call(listPosts, { offset: -1 }, { context: ctx(db) })).rejects.toThrow();
  });
});

describe("PL-008 getPost", () => {
  // AC2: a published post is returned with the expected shape.
  test("returns a published post by id", async () => {
    const post = await call(getPost, { id: "pub-new" }, { context: ctx(db) });
    expect(post.id).toBe("pub-new");
    expect(post.status).toBe("published");
    expect(post.title).toBe("Newest published");
  });

  // AC2 + no-leak invariant: unpublished resolves to NOT_FOUND, never the row.
  test("returns NOT_FOUND for an unpublished post (no leak)", async () => {
    let thrown: unknown;
    try {
      await call(getPost, { id: "unpub-1" }, { context: ctx(db) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ORPCError);
    expect((thrown as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  // AC2 + no-leak invariant: draft resolves to NOT_FOUND, never the row.
  test("returns NOT_FOUND for a draft post (no leak)", async () => {
    await expect(call(getPost, { id: "draft-1" }, { context: ctx(db) })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // AC2: missing id and unpublished id are indistinguishable (both NOT_FOUND).
  test("returns NOT_FOUND for a missing post", async () => {
    await expect(call(getPost, { id: "does-not-exist" }, { context: ctx(db) })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  });

  // Contract: empty id is rejected by the procedure schema.
  test("rejects an empty id", async () => {
    await expect(call(getPost, { id: "" }, { context: ctx(db) })).rejects.toThrow();
  });
});
