/// <reference types="bun" />
import { expect, test, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { call, ORPCError } from "@orpc/server";
import * as schema from "@paperlens/db/schema/paperlens";
import { getActivePrompt, updateActivePrompt } from "./prompt";
import type { Context, Db } from "../context";

// In-memory SQLite with the real D1 migration applied — same dialect and schema
// as production, no Cloudflare binding or network. Mirrors auth.test.ts.
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

// Inject the oRPC context (db + session) directly — never the prod
// createContext (which reads Cloudflare bindings). null session =
// unauthenticated; an object with a truthy `user` = an authenticated owner.
function ctx(session: Context["session"], db: BunSQLiteDatabase<typeof schema>): Context {
  return { auth: null, session, db: db as unknown as Db };
}

function ownerSession(): Context["session"] {
  return {
    session: { id: "sess-1", userId: "owner-1" },
    user: { id: "owner-1", email: "owner@example.com" },
  } as unknown as Context["session"];
}

// Seed exactly one active StylePrompt (the single-active starting state).
async function seedActive(db: BunSQLiteDatabase<typeof schema>, content: string): Promise<string> {
  const [row] = await db
    .insert(schema.stylePrompts)
    .values({ content, isActive: true })
    .returning({ id: schema.stylePrompts.id });
  return row!.id;
}

function activeRows(db: BunSQLiteDatabase<typeof schema>) {
  return db.select().from(schema.stylePrompts).where(eq(schema.stylePrompts.isActive, true));
}

let db: BunSQLiteDatabase<typeof schema>;

beforeEach(async () => {
  db = await makeDb();
});

describe("PL-015 getActivePrompt", () => {
  // Scenario: Owner reads the active prompt.
  test("returns the active StylePrompt id and content for an owner", async () => {
    const id = await seedActive(db, "the active voice");

    const result = await call(getActivePrompt, undefined, { context: ctx(ownerSession(), db) });

    expect(result).toEqual({ id, content: "the active voice" });
  });

  test("returns exactly { id, content } — no other StylePrompt columns leak", async () => {
    await seedActive(db, "voice");
    const result = await call(getActivePrompt, undefined, { context: ctx(ownerSession(), db) });
    expect(Object.keys(result).sort()).toEqual(["content", "id"]);
  });
});

describe("PL-015 updateActivePrompt — single-active invariant", () => {
  // Scenario: Update persists content and keeps one active prompt.
  test("persists new content and keeps exactly one active prompt", async () => {
    await seedActive(db, "old voice");

    const result = await call(
      updateActivePrompt,
      { content: "new voice" },
      { context: ctx(ownerSession(), db) },
    );

    expect(result.content).toBe("new voice");

    const active = await activeRows(db);
    expect(active).toHaveLength(1);
    expect(active[0]!.content).toBe("new voice");

    // No extra row was created — content updated in place.
    const total = await db.select().from(schema.stylePrompts);
    expect(total).toHaveLength(1);
  });

  test("keeps exactly one active prompt across consecutive updates", async () => {
    await seedActive(db, "v1");
    await call(updateActivePrompt, { content: "v2" }, { context: ctx(ownerSession(), db) });
    await call(updateActivePrompt, { content: "v3" }, { context: ctx(ownerSession(), db) });

    const active = await activeRows(db);
    expect(active).toHaveLength(1);
    expect(active[0]!.content).toBe("v3");
  });
});

describe("PL-015 auth gate — both procedures reject unauthenticated calls", () => {
  // Scenario: Unauthenticated read is rejected with 401, reads nothing.
  test("getActivePrompt without a session throws 401 (UNAUTHORIZED)", async () => {
    await seedActive(db, "voice");
    let thrown: unknown;
    try {
      await call(getActivePrompt, undefined, { context: ctx(null, db) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ORPCError);
    const err = thrown as ORPCError<string, unknown>;
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.status).toBe(401);
  });

  // Scenario: Unauthenticated update is rejected with 401, mutates nothing.
  test("updateActivePrompt without a session throws 401 and does not mutate", async () => {
    await seedActive(db, "untouched");

    await expect(
      call(updateActivePrompt, { content: "should not persist" }, { context: ctx(null, db) }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });

    const active = await activeRows(db);
    expect(active).toHaveLength(1);
    expect(active[0]!.content).toBe("untouched");
  });

  // The 401 must short-circuit BEFORE any db work: a handler-side sentinel
  // (PL-014 pattern) wired onto protectedProcedure proves the gate runs first.
  test("the auth gate runs before the handler (sentinel stays false on denial)", async () => {
    const { protectedProcedure } = await import("../index");
    let handlerRan = false;
    const sentinel = protectedProcedure.handler(() => {
      handlerRan = true;
      return "ok";
    });

    await expect(call(sentinel, undefined, { context: ctx(null, db) })).rejects.toBeInstanceOf(
      ORPCError,
    );
    expect(handlerRan).toBe(false);
  });
});

describe("PL-015 contract shapes", () => {
  test("updateActivePrompt rejects empty content", async () => {
    await seedActive(db, "voice");
    await expect(
      call(updateActivePrompt, { content: "" }, { context: ctx(ownerSession(), db) }),
    ).rejects.toBeDefined();
  });

  test("getActivePrompt output is { id: string, content: string }", async () => {
    await seedActive(db, "voice");
    const result = await call(getActivePrompt, undefined, { context: ctx(ownerSession(), db) });
    expect(typeof result.id).toBe("string");
    expect(typeof result.content).toBe("string");
  });
});
