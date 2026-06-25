/// <reference types="bun" />
import { expect, test, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { call, ORPCError } from "@orpc/server";
import * as schema from "@paperlens/db/schema/paperlens";
import { protectedProcedure, publicProcedure } from "../index";
import { listPosts, getPost } from "./posts";
import type { Context, Db } from "../context";

// In-memory SQLite with the real D1 migration applied — same dialect and schema
// as production, no Cloudflare binding or network. Mirrors posts.test.ts.
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

// Build the oRPC context the procedures read. Tests inject their own context
// (db + session) and NEVER call the prod createContext (which reads Cloudflare
// bindings). `session` is what the auth gate inspects: null = unauthenticated,
// an object with a truthy `user` = an authenticated owner.
function ctx(session: Context["session"], db: BunSQLiteDatabase<typeof schema>): Context {
  return { auth: null, session, db: db as unknown as Db };
}

// A minimal owner session: the gate only checks `session.user` truthiness, so a
// small user object faithfully stands in for a Better Auth session. Cast to the
// resolved session type to keep the injected context honest.
function ownerSession(): Context["session"] {
  return {
    session: { id: "sess-1", userId: "owner-1" },
    user: { id: "owner-1", email: "owner@example.com" },
  } as unknown as Context["session"];
}

// A console (auth-gated) procedure built on protectedProcedure, exactly as the
// future console routers (getActivePrompt/updateActivePrompt, triggerRun, ...)
// will be. The sentinel proves the handler body never runs when the gate denies.
let handlerRan = false;
const consoleProcedure = protectedProcedure.handler(({ context }) => {
  handlerRan = true;
  return { ok: true, userId: context.session.user.id };
});

// A public reader-style procedure built on publicProcedure — confirms the base
// procedure is never gated.
const publicEcho = publicProcedure.handler(() => "public-ok");

let db: BunSQLiteDatabase<typeof schema>;

beforeEach(async () => {
  db = await makeDb();
  handlerRan = false;
});

describe("PL-014 console auth gate", () => {
  // Scenario: Unauthenticated console call returns 401.
  test("rejects an unauthenticated console call with 401 (UNAUTHORIZED)", async () => {
    let thrown: unknown;
    try {
      await call(consoleProcedure, undefined, { context: ctx(null, db) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ORPCError);
    const err = thrown as ORPCError<string, unknown>;
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.status).toBe(401);
  });

  // Scenario: 401 happens BEFORE the handler — no console state is read/mutated.
  test("does not run the console handler when unauthenticated", async () => {
    await expect(
      call(consoleProcedure, undefined, { context: ctx(null, db) }),
    ).rejects.toBeInstanceOf(ORPCError);
    expect(handlerRan).toBe(false);
  });

  // Fail closed: a session object missing `user` is still unauthenticated.
  test("treats a session without a user as unauthenticated (401)", async () => {
    const noUser = { session: { id: "s" } } as unknown as Context["session"];
    await expect(
      call(consoleProcedure, undefined, { context: ctx(noUser, db) }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(handlerRan).toBe(false);
  });

  // Scenario: Authenticated owner reaches the console (integration — db harness
  // present, valid owner session injected).
  test("an authenticated owner reaches the console procedure", async () => {
    const result = await call(consoleProcedure, undefined, {
      context: ctx(ownerSession(), db),
    });
    expect(handlerRan).toBe(true);
    expect(result).toEqual({ ok: true, userId: "owner-1" });
  });
});

describe("PL-014 reader surface stays public", () => {
  // Insert one published post so the public reader has content to return.
  beforeEach(async () => {
    const arxivId = "2401.00001";
    await db.insert(schema.papers).values({
      arxivId,
      title: "paper",
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
      id: "pub-1",
      paperId: arxivId,
      digestId: digest.id,
      stylePromptId: prompt.id,
      title: "Published",
      body: "body",
      citation: "cite",
      status: "published",
      publishedAt: new Date("2024-01-01T00:00:00Z"),
      model: "test-model",
    });
  });

  // Scenario: Public reader query without a session — listPosts succeeds.
  test("listPosts succeeds without a session", async () => {
    const { items } = await call(listPosts, {}, { context: ctx(null, db) });
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("pub-1");
    expect(items[0]!.status).toBe("published");
  });

  // Scenario: Public reader query without a session — getPost succeeds.
  test("getPost succeeds without a session", async () => {
    const post = await call(getPost, { id: "pub-1" }, { context: ctx(null, db) });
    expect(post.id).toBe("pub-1");
    expect(post.status).toBe("published");
  });

  // The public base procedure is never gated, even with no session.
  test("a public procedure runs without a session", async () => {
    const res = await call(publicEcho, undefined, { context: ctx(null, db) });
    expect(res).toBe("public-ok");
  });
});
