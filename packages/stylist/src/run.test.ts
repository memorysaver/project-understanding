/// <reference types="bun" />
import { expect, test, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "@paperlens/db/schema/paperlens";
import { seedDefaultStylePrompt, DEFAULT_STYLE_PROMPT } from "@paperlens/db/seed";
import type { LlmMessage } from "@paperlens/llm";
import type { complete as Complete } from "@paperlens/llm";
import { run } from "./run";

// Locate the D1 migration that ships with @paperlens/db relative to its seed
// module (the package's `./*` export only maps `.ts`, not the `.sql` file).
const MIGRATION_URL = new URL(
  "./migrations/0000_keen_supernaut.sql",
  import.meta.resolve("@paperlens/db/seed"),
);

// Build an in-memory SQLite database with the real D1 migration applied. D1 and
// bun-sqlite share the SQLite dialect, so the same migration + Drizzle defs
// exercise the real schema without a Cloudflare binding (mirrors db tests).
async function makeDb(): Promise<BunSQLiteDatabase<typeof schema>> {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  const migration = await Bun.file(MIGRATION_URL).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.run(trimmed);
  }
  return drizzle(sqlite, { schema });
}

// A digested paper + its Digest — the fixture the stylist consumes.
async function seedDigestedPaper(db: BunSQLiteDatabase<typeof schema>, paperId: string) {
  await db.insert(schema.papers).values({
    arxivId: paperId,
    title: "Attention without all the hype",
    authors: ["Ada"],
    abstract: "abs",
    sourceUrl: `https://arxiv.org/abs/${paperId}`,
    status: "digested",
  });
  const digest = (
    await db
      .insert(schema.digests)
      .values({
        paperId,
        contributions: ["A new attention variant"],
        methods: ["Linear-time kernel approximation"],
        results: ["2x faster with no quality loss"],
        model: "digest-model",
      })
      .returning()
  )[0]!;
  return digest;
}

// A spy `complete` capturing the messages it was called with, returning a fixed
// styled body. Typed to the real signature so the contract stays honest.
function mockComplete(body: string) {
  const calls: { stage: string; messages: LlmMessage[] }[] = [];
  const fn = (async (args: { stage: string; messages: LlmMessage[] }) => {
    calls.push({ stage: args.stage, messages: args.messages });
    return { content: body, model: "style-model", usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } };
  }) as unknown as typeof Complete;
  return { fn, calls };
}

describe("PL-005 stylist", () => {
  // AC1 + integration: digest -> non-empty styled body via mocked llm.
  test("produces a non-empty styled body from a Digest using the active prompt", async () => {
    const db = await makeDb();
    await seedDefaultStylePrompt(db);
    const digest = await seedDigestedPaper(db, "2401.00001");
    const llm = mockComplete("Here is a thoughtful styled post body.");

    const result = await run({ db, complete: llm.fn }, { paperId: "2401.00001" });

    expect(result.body.trim().length).toBeGreaterThan(0);
    expect(result.body).toBe("Here is a thoughtful styled post body.");
    expect(result.digestId).toBe(digest.id);
  });

  // Unit: it loads and uses the ACTIVE StylePrompt as the system/style message.
  test("uses the active StylePrompt as the system instruction", async () => {
    const db = await makeDb();
    await seedDefaultStylePrompt(db);
    await seedDigestedPaper(db, "2401.00002");
    const llm = mockComplete("styled");

    const result = await run({ db, complete: llm.fn }, { paperId: "2401.00002" });

    const active = (
      await db.select().from(schema.stylePrompts).where(eq(schema.stylePrompts.isActive, true))
    )[0]!;
    expect(result.stylePromptId).toBe(active.id);

    const call = llm.calls[0]!;
    expect(call.stage).toBe("style");
    const system = call.messages.find((m) => m.role === "system")!;
    expect(system.content).toBe(DEFAULT_STYLE_PROMPT);
    expect(system.content).toBe(active.content);
  });

  // Unit: it uses the ACTIVE prompt even after the default is replaced — proves
  // it reads is_active, not the seeded default by accident.
  test("uses the currently active prompt after the active prompt is flipped", async () => {
    const db = await makeDb();
    await seedDefaultStylePrompt(db);
    await db.transaction(async (tx) => {
      await tx.update(schema.stylePrompts).set({ isActive: false }).where(eq(schema.stylePrompts.isActive, true));
      await tx.insert(schema.stylePrompts).values({ content: "A sharper, terser voice.", isActive: true });
    });
    await seedDigestedPaper(db, "2401.00003");
    const llm = mockComplete("styled");

    await run({ db, complete: llm.fn }, { paperId: "2401.00003" });

    const system = llm.calls[0]!.messages.find((m) => m.role === "system")!;
    expect(system.content).toBe("A sharper, terser voice.");
  });

  // AC2: Paper advances to status `styled` on success.
  test("advances the Paper to status styled on success", async () => {
    const db = await makeDb();
    await seedDefaultStylePrompt(db);
    await seedDigestedPaper(db, "2401.00004");
    const llm = mockComplete("styled");

    await run({ db, complete: llm.fn }, { paperId: "2401.00004" });

    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, "2401.00004"))
    )[0]!;
    expect(paper.status).toBe("styled");
  });

  // Contract: the styled output shape the publisher will consume.
  test("returns the styled-body output shape", async () => {
    const db = await makeDb();
    await seedDefaultStylePrompt(db);
    const digest = await seedDigestedPaper(db, "2401.00005");
    const llm = mockComplete("styled body");

    const result = await run({ db, complete: llm.fn }, { paperId: "2401.00005" });

    expect(result).toEqual({
      paperId: "2401.00005",
      body: "styled body",
      stylePromptId: expect.any(String),
      digestId: digest.id,
      model: "style-model",
    });
  });

  // Guardrail: an empty styled body is rejected and the paper is not advanced.
  test("rejects an empty styled body and leaves the paper unchanged", async () => {
    const db = await makeDb();
    await seedDefaultStylePrompt(db);
    await seedDigestedPaper(db, "2401.00006");
    const llm = mockComplete("   ");

    await expect(run({ db, complete: llm.fn }, { paperId: "2401.00006" })).rejects.toThrow();

    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, "2401.00006"))
    )[0]!;
    expect(paper.status).toBe("digested");
  });
});
