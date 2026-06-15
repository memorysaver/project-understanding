/// <reference types="bun" />
import { expect, test, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "@paperlens/db/schema/index";
import { seedDefaultStylePrompt } from "@paperlens/db/seed";
import { publish, sanitizeBody, buildCitation } from "./index";

// Build an in-memory SQLite database with the real PL-001 migration applied.
// D1 and bun-sqlite share the SQLite dialect, so the same migration SQL and
// Drizzle table defs exercise the real schema without a Cloudflare binding.
async function makeDb(): Promise<BunSQLiteDatabase<typeof schema>> {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  // The migration ships with @paperlens/db; resolve it relative to the package.
  const schemaUrl = import.meta.resolve("@paperlens/db/schema/paperlens");
  const migrationUrl = new URL("../migrations/0000_keen_supernaut.sql", schemaUrl);
  const migration = await Bun.file(migrationUrl).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.run(trimmed);
  }
  return drizzle(sqlite, { schema });
}

// Seed a Paper (styled), its Digest, and the active StylePrompt — the inputs a
// publish() call expects upstream of itself.
async function seedStyledPaper(db: BunSQLiteDatabase<typeof schema>) {
  const arxivId = "2406.00006";
  await db.insert(schema.papers).values({
    arxivId,
    title: "Attention Is All You Need, Revisited",
    authors: ["Ada Lovelace", "Alan Turing"],
    abstract: "An abstract.",
    sourceUrl: `https://arxiv.org/abs/${arxivId}`,
    status: "styled",
  });
  const digest = (
    await db
      .insert(schema.digests)
      .values({
        paperId: arxivId,
        contributions: ["c"],
        methods: ["m"],
        results: ["r"],
        model: "digest-model",
      })
      .returning()
  )[0]!;
  await seedDefaultStylePrompt(db);
  const prompt = (await db.select().from(schema.stylePrompts))[0]!;
  return { arxivId, digestId: digest.id, stylePromptId: prompt.id };
}

describe("PL-006 publisher — unit", () => {
  test("sanitizeBody strips <script> and its contents", () => {
    const out = sanitizeBody("<p>Hello</p><script>alert('xss')</script><p>World</p>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
    expect(out).toContain("<p>Hello</p>");
    expect(out).toContain("<p>World</p>");
  });

  test("sanitizeBody drops event-handler attributes and javascript: URLs", () => {
    const out = sanitizeBody(
      `<a href="javascript:steal()" onclick="hack()">link</a><img src="x" onerror="boom()">`,
    );
    expect(out.toLowerCase()).not.toContain("onclick");
    expect(out.toLowerCase()).not.toContain("onerror");
    expect(out.toLowerCase()).not.toContain("javascript:");
    // The anchor text survives; the disallowed <img> tag is removed.
    expect(out).toContain("link");
    expect(out).not.toContain("<img");
  });

  test("sanitizeBody keeps safe formatting markup", () => {
    const out = sanitizeBody(
      '<p>It is <strong>great</strong>. <a href="https://x.test">src</a></p>',
    );
    expect(out).toContain("<strong>great</strong>");
    expect(out).toContain('href="https://x.test"');
  });

  test("buildCitation assembles authors, title, arXiv id, and source link", () => {
    const c = buildCitation({
      arxivId: "2401.00001",
      title: "On Computable Numbers",
      authors: ["Ada Lovelace", "Alan Turing"],
      sourceUrl: "https://arxiv.org/abs/2401.00001",
    });
    expect(c).toContain("Ada Lovelace, Alan Turing");
    expect(c).toContain("On Computable Numbers");
    expect(c).toContain("arXiv:2401.00001");
    expect(c).toContain("https://arxiv.org/abs/2401.00001");
  });
});

describe("PL-006 publisher — integration (in-memory db)", () => {
  test("styled body -> published Post with all fields populated", async () => {
    const db = await makeDb();
    const { arxivId, digestId, stylePromptId } = await seedStyledPaper(db);

    const post = await publish(db, {
      paperId: arxivId,
      digestId,
      stylePromptId,
      title: "Why this paper matters",
      styledBody: "<p>A clear, styled explanation.</p>",
      model: "style-model",
    });

    // AC1: a published Post with title, body, citation, and source link, no tags.
    expect(post.title).toBe("Why this paper matters");
    expect(post.body).toBe("<p>A clear, styled explanation.</p>");
    expect(post.citation).toContain("Attention Is All You Need, Revisited");
    expect(post.citation).toContain("Ada Lovelace, Alan Turing");
    expect(post.citation).toContain(`arXiv:${arxivId}`);
    // The link back to the source paper is carried in the citation.
    expect(post.citation).toContain(`https://arxiv.org/abs/${arxivId}`);
    expect(post.paperId).toBe(arxivId);
    expect(post.digestId).toBe(digestId);
    expect(post.stylePromptId).toBe(stylePromptId);
    expect(post.model).toBe("style-model");
    expect(post.tags).toBeNull();
    expect(post.id).toBeTruthy();
    expect(post.createdAt).toBeInstanceOf(Date);
  });

  test("Post is published and published_at invariant holds", async () => {
    const db = await makeDb();
    const { arxivId, digestId, stylePromptId } = await seedStyledPaper(db);

    const before = Date.now();
    const post = await publish(db, {
      paperId: arxivId,
      digestId,
      stylePromptId,
      title: "T",
      styledBody: "<p>body</p>",
      model: "m",
    });

    // AC2 (Post half): status published, published_at non-null and sensible.
    expect(post.status).toBe("published");
    expect(post.publishedAt).not.toBeNull();
    expect(post.publishedAt).toBeInstanceOf(Date);
    expect(post.publishedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("source Paper advances to published", async () => {
    const db = await makeDb();
    const { arxivId, digestId, stylePromptId } = await seedStyledPaper(db);

    await publish(db, {
      paperId: arxivId,
      digestId,
      stylePromptId,
      title: "T",
      styledBody: "<p>body</p>",
      model: "m",
    });

    // AC2 (Paper half): the source paper advanced styled -> published.
    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, arxivId))
    )[0]!;
    expect(paper.status).toBe("published");
  });

  test("unsafe markup in the styled body is removed before storage", async () => {
    const db = await makeDb();
    const { arxivId, digestId, stylePromptId } = await seedStyledPaper(db);

    const post = await publish(db, {
      paperId: arxivId,
      digestId,
      stylePromptId,
      title: "T",
      styledBody: `<p>Real content</p><script>fetch('//evil')</script><a href="javascript:x()" onclick="y()">z</a>`,
      model: "m",
    });

    // The persisted, renderable body carries no executable markup.
    expect(post.body).toContain("Real content");
    expect(post.body).not.toContain("<script");
    expect(post.body).not.toContain("fetch('//evil')");
    expect(post.body.toLowerCase()).not.toContain("onclick");
    expect(post.body.toLowerCase()).not.toContain("javascript:");
  });

  test("publishing an unknown paper throws", async () => {
    const db = await makeDb();
    await seedDefaultStylePrompt(db);
    const prompt = (await db.select().from(schema.stylePrompts))[0]!;
    expect(
      publish(db, {
        paperId: "9999.99999",
        digestId: "no-such-digest",
        stylePromptId: prompt.id,
        title: "T",
        styledBody: "<p>x</p>",
        model: "m",
      }),
    ).rejects.toThrow(/source paper not found/);
  });
});
