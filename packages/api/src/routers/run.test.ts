/// <reference types="bun" />
import { expect, test, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { call, ORPCError } from "@orpc/server";
import type { PipelineMessage, QueueProducer } from "@paperlens/orchestrator";
import * as schema from "@paperlens/db/schema/paperlens";
import { triggerRun } from "./run";
import type { Context, Db } from "../context";

// In-memory SQLite with the real D1 migration applied — same dialect and schema
// as production, no Cloudflare binding or network. Mirrors auth.test.ts /
// prompt.test.ts. The `runs` table is created by 0000 (PL-001).
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

// A recording fake QueueProducer — captures every message the orchestrator's
// enqueueDiscovery sends instead of delivering it to a real Cloudflare Queue.
function recordingQueue(): { producer: QueueProducer; sent: PipelineMessage[] } {
  const sent: PipelineMessage[] = [];
  return {
    sent,
    producer: {
      send: async (message) => {
        sent.push(message);
      },
    },
  };
}

// Inject the oRPC context (db + session + queue) directly — never the prod
// createContext (which reads Cloudflare bindings). null session =
// unauthenticated; an object with a truthy `user` = an authenticated owner. The
// queue is the recording fake so the test asserts what was enqueued.
function ctx(
  session: Context["session"],
  db: BunSQLiteDatabase<typeof schema>,
  queue: QueueProducer,
): Context {
  return { auth: null, session, db: db as unknown as Db, queue };
}

function ownerSession(): Context["session"] {
  return {
    session: { id: "sess-1", userId: "owner-1" },
    user: { id: "owner-1", email: "owner@example.com" },
  } as unknown as Context["session"];
}

function runRows(db: BunSQLiteDatabase<typeof schema>) {
  return db.select().from(schema.runs);
}

let db: BunSQLiteDatabase<typeof schema>;

beforeEach(async () => {
  db = await makeDb();
});

describe("PL-020 triggerRun — auth required (5.1)", () => {
  // Scenario: Unauthenticated trigger is rejected with 401.
  test("without a session throws 401 (UNAUTHORIZED)", async () => {
    const { producer } = recordingQueue();
    let thrown: unknown;
    try {
      await call(triggerRun, undefined, { context: ctx(null, db, producer) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ORPCError);
    const err = thrown as ORPCError<string, unknown>;
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.status).toBe(401);
  });

  // Scenario: the 401 short-circuits BEFORE any side effect — no Run row is
  // created and no message is enqueued.
  test("does not create a Run row or enqueue a message when unauthenticated", async () => {
    const { producer, sent } = recordingQueue();

    await expect(
      call(triggerRun, undefined, { context: ctx(null, db, producer) }),
    ).rejects.toBeInstanceOf(ORPCError);

    expect(sent).toHaveLength(0);
    expect(await runRows(db)).toHaveLength(0);
  });

  // The gate runs before the handler: a handler-side sentinel on
  // protectedProcedure (PL-014 pattern) proves the short-circuit.
  test("the auth gate runs before the handler (sentinel stays false on denial)", async () => {
    const { producer } = recordingQueue();
    const { protectedProcedure } = await import("../index");
    let handlerRan = false;
    const sentinel = protectedProcedure.handler(() => {
      handlerRan = true;
      return "ok";
    });

    await expect(
      call(sentinel, undefined, { context: ctx(null, db, producer) }),
    ).rejects.toBeInstanceOf(ORPCError);
    expect(handlerRan).toBe(false);
  });
});

describe("PL-020 triggerRun — trigger enqueues a run (5.2)", () => {
  // Scenario: Owner triggers a run and it is enqueued.
  test("creates exactly one manual Run row and enqueues exactly one matching discover message", async () => {
    const { producer, sent } = recordingQueue();

    const result = await call(triggerRun, undefined, {
      context: ctx(ownerSession(), db, producer),
    });

    // Exactly one Run row, trigger = manual.
    const rows = await runRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trigger).toBe("manual");

    // Exactly one discover message, carrying the returned runId.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: "discover", runId: result.runId });

    // The returned runId is the created Run's id (the message + row agree).
    expect(result.runId).toBe(rows[0]!.id);
  });
});

describe("PL-020 triggerRun — contract shape (5.3)", () => {
  // The console button consumes { runId: string }.
  test("returns { runId: string }", async () => {
    const { producer } = recordingQueue();
    const result = await call(triggerRun, undefined, {
      context: ctx(ownerSession(), db, producer),
    });
    expect(Object.keys(result)).toEqual(["runId"]);
    expect(typeof result.runId).toBe("string");
    expect(result.runId.length).toBeGreaterThan(0);
  });
});
