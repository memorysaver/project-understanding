/// <reference types="bun" />
import { expect, test, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq, sql } from "drizzle-orm";
import * as schema from "./schema";
import { seedDefaultStylePrompt } from "./seed";

// Build an in-memory SQLite database with the generated D1 migration applied.
// D1 and bun-sqlite share the SQLite dialect, so the same migration SQL and
// Drizzle table defs exercise the real schema without a Cloudflare binding.
async function makeDb(): Promise<BunSQLiteDatabase<typeof schema>> {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  const url = new URL("./migrations/0000_keen_supernaut.sql", import.meta.url);
  const migration = await Bun.file(url).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.run(trimmed);
  }
  return drizzle(sqlite, { schema });
}

describe("PL-001 persistence", () => {
  // Task 3.4 — migrations apply cleanly and auth tables are untouched.
  test("migrations create all core tables and leave auth tables present", async () => {
    const db = await makeDb();
    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    );
    const names = rows.map((r) => r.name);
    for (const t of ["papers", "digests", "style_prompts", "posts", "runs"]) {
      expect(names).toContain(t);
    }
    for (const t of ["user", "session", "account", "verification"]) {
      expect(names).toContain(t);
    }
  });

  // Task 3.1 — duplicate arxiv_id insert is a no-op (dedup).
  test("inserting a duplicate arxiv_id is a no-op", async () => {
    const db = await makeDb();
    await db.insert(schema.papers).values({
      arxivId: "2401.00001",
      title: "Original",
      authors: ["Ada"],
      abstract: "first",
      sourceUrl: "https://arxiv.org/abs/2401.00001",
    });
    await db
      .insert(schema.papers)
      .values({
        arxivId: "2401.00001",
        title: "Duplicate",
        authors: ["Bob"],
        abstract: "second",
        sourceUrl: "https://arxiv.org/abs/2401.00001",
      })
      .onConflictDoNothing();

    const all = await db.select().from(schema.papers);
    expect(all).toHaveLength(1);
    expect(all[0]!.title).toBe("Original");
  });

  // Task 3.2 — single-active StylePrompt invariant after seed and after update.
  test("exactly one active StylePrompt after seed and after an active-prompt flip", async () => {
    const db = await makeDb();
    await seedDefaultStylePrompt(db);

    const afterSeed = await db
      .select()
      .from(schema.stylePrompts)
      .where(eq(schema.stylePrompts.isActive, true));
    expect(afterSeed).toHaveLength(1);

    // Transactional flip: deactivate current active, activate a new prompt.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.stylePrompts)
        .set({ isActive: false })
        .where(eq(schema.stylePrompts.isActive, true));
      await tx.insert(schema.stylePrompts).values({ content: "A different voice", isActive: true });
    });

    const afterFlip = await db
      .select()
      .from(schema.stylePrompts)
      .where(eq(schema.stylePrompts.isActive, true));
    expect(afterFlip).toHaveLength(1);
    expect(afterFlip[0]!.content).toBe("A different voice");

    const total = await db.select().from(schema.stylePrompts);
    expect(total).toHaveLength(2);
  });

  // Task 3.3 — new paper defaults to discovered; published post has published_at.
  test("a new paper defaults to discovered status", async () => {
    const db = await makeDb();
    await db.insert(schema.papers).values({
      arxivId: "2402.12345",
      title: "Fresh crawl",
      authors: ["Carol"],
      abstract: "abs",
      sourceUrl: "https://arxiv.org/abs/2402.12345",
    });
    const paper = (await db.select().from(schema.papers))[0]!;
    expect(paper.status).toBe("discovered");
  });

  test("a published post carries a non-null published_at", async () => {
    const db = await makeDb();
    await db.insert(schema.papers).values({
      arxivId: "2403.00009",
      title: "P",
      authors: ["Dan"],
      abstract: "abs",
      sourceUrl: "https://arxiv.org/abs/2403.00009",
    });
    const digest = (
      await db
        .insert(schema.digests)
        .values({
          paperId: "2403.00009",
          contributions: ["c"],
          methods: ["m"],
          results: ["r"],
          model: "test-model",
        })
        .returning()
    )[0]!;
    await seedDefaultStylePrompt(db);
    const prompt = (await db.select().from(schema.stylePrompts))[0]!;

    const publishedAt = new Date();
    const post = (
      await db
        .insert(schema.posts)
        .values({
          paperId: "2403.00009",
          digestId: digest.id,
          stylePromptId: prompt.id,
          title: "Published title",
          body: "body",
          citation: "cite",
          status: "published",
          publishedAt,
          model: "test-model",
        })
        .returning()
    )[0]!;

    expect(post.status).toBe("published");
    expect(post.publishedAt).not.toBeNull();
    expect(post.publishedAt).toBeInstanceOf(Date);
  });
});
