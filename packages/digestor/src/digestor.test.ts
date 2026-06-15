/// <reference types="bun" />
import type { DigestComplete, Paper } from "./index";
import { expect, test, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "@paperlens/db/schema/paperlens";
import { LlmError } from "@paperlens/llm";
import { run, digestSchema, fetchArxivFullText } from "./index";

// In-memory SQLite with the generated D1 migration applied. D1 and bun-sqlite
// share the SQLite dialect, so the same migration SQL + Drizzle defs exercise the
// real schema offline (mirrors packages/db/src/paperlens.test.ts).
async function makeDb(): Promise<BunSQLiteDatabase<typeof schema>> {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  const url = new URL(
    "./migrations/0000_keen_supernaut.sql",
    import.meta.resolve("@paperlens/db/seed"),
  );
  const migration = await Bun.file(url).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.run(trimmed);
  }
  return drizzle(sqlite, { schema });
}

async function insertPaper(
  db: BunSQLiteDatabase<typeof schema>,
  overrides: Partial<Paper> = {},
): Promise<void> {
  await db.insert(schema.papers).values({
    arxivId: "2401.00004",
    title: "A Study of Things",
    authors: ["Ada Lovelace"],
    abstract: "We study things and find results.",
    sourceUrl: "https://arxiv.org/abs/2401.00004",
    fullTextUrl: "https://arxiv.org/html/2401.00004",
    ...overrides,
  });
}

const FIXTURE_FULL_TEXT =
  "Introduction. We propose a new method M. Methods: we trained on dataset D. " +
  "Results: M improves accuracy by 5 points over the baseline.";

const CANNED_DIGEST = {
  contributions: ["Proposes method M for the task."],
  methods: ["Trains M on dataset D."],
  results: ["M improves accuracy by 5 points over the baseline."],
};

// A mock llm.complete that returns a canned structured digest. Asserts the
// digestor calls the digest stage with a schema — and never touches the network.
function mockComplete(json = CANNED_DIGEST, model = "mock/digest-model"): DigestComplete {
  return async (args) => {
    expect(args.stage).toBe("digest");
    expect(args.schema).toBe(digestSchema);
    return { json, model, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  };
}

// A fixture fetcher — no network. Asserts the real paper row is passed in.
const fixtureFetcher = async (paper: Paper): Promise<string> => {
  expect(paper.arxivId).toBe("2401.00004");
  return FIXTURE_FULL_TEXT;
};

describe("PL-004 digestor", () => {
  // Acceptance criterion 1 — produces a Digest with contributions/methods/results.
  test("produces a Digest with contributions, methods, and results from full text", async () => {
    const db = await makeDb();
    await insertPaper(db);

    const digest = await run({
      paperId: "2401.00004",
      db,
      fetchFullText: fixtureFetcher,
      complete: mockComplete(),
    });

    expect(digest.contributions).toEqual(CANNED_DIGEST.contributions);
    expect(digest.methods).toEqual(CANNED_DIGEST.methods);
    expect(digest.results).toEqual(CANNED_DIGEST.results);
    expect(digest.model).toBe("mock/digest-model");
  });

  // Acceptance criterion 2 — Digest persisted and Paper advances to `digested`.
  test("persists the Digest, links it to the Paper, and advances status to digested", async () => {
    const db = await makeDb();
    await insertPaper(db);

    await run({
      paperId: "2401.00004",
      db,
      fetchFullText: fixtureFetcher,
      complete: mockComplete(),
    });

    const rows = await db
      .select()
      .from(schema.digests)
      .where(eq(schema.digests.paperId, "2401.00004"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.paperId).toBe("2401.00004");
    expect(rows[0]!.rawJson).toEqual(CANNED_DIGEST);

    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, "2401.00004"))
    )[0]!;
    expect(paper.status).toBe("digested");
  });

  // Acceptance criterion 3 — LLM failure rethrows and leaves Paper at discovered.
  test("on LLM failure, throws for retry and leaves the Paper at discovered (no Digest)", async () => {
    const db = await makeDb();
    await insertPaper(db);

    const failing: DigestComplete = async () => {
      throw new LlmError("OpenRouter request failed", { status: 503, retryable: true });
    };

    await expect(
      run({ paperId: "2401.00004", db, fetchFullText: fixtureFetcher, complete: failing }),
    ).rejects.toThrow(LlmError);

    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, "2401.00004"))
    )[0]!;
    expect(paper.status).toBe("discovered");

    const rows = await db.select().from(schema.digests);
    expect(rows).toHaveLength(0);
  });

  // Integration — full-text fetch (fixture) -> digest on a real fixture paper.
  test("integration: fetches full text then digests a fixture paper with a mocked llm", async () => {
    const db = await makeDb();
    await insertPaper(db);

    let seenText = "";
    const digest = await run({
      paperId: "2401.00004",
      db,
      fetchFullText: async (paper) => {
        seenText = await fixtureFetcher(paper);
        return seenText;
      },
      // Echo the fetched text into a contribution to prove it flowed through.
      complete: async (args) => {
        const userMsg = args.messages.find((m) => m.role === "user")!.content;
        expect(userMsg).toContain(FIXTURE_FULL_TEXT);
        return {
          json: { ...CANNED_DIGEST, contributions: ["from: " + seenText.slice(0, 12)] },
          model: "mock/digest-model",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
    });

    expect(digest.contributions[0]).toBe("from: Introduction");
  });

  // Contract — the Digest output shape validates against the published schema.
  test("contract: the Digest content conforms to digestSchema", async () => {
    const db = await makeDb();
    await insertPaper(db);

    const digest = await run({
      paperId: "2401.00004",
      db,
      fetchFullText: fixtureFetcher,
      complete: mockComplete(),
    });

    const parsed = digestSchema.safeParse({
      contributions: digest.contributions,
      methods: digest.methods,
      results: digest.results,
    });
    expect(parsed.success).toBe(true);
  });

  // Default fetcher — prefers the arXiv HTML source and strips tags; on a failed
  // fetch it falls back to the abstract. Network is stubbed via globalThis.fetch.
  test("default fetcher prefers HTML source and falls back to the abstract", async () => {
    const paper = {
      arxivId: "2401.00004",
      title: "t",
      authors: ["a"],
      abstract: "the stored abstract",
      sourceUrl: "https://arxiv.org/abs/2401.00004",
      fullTextUrl: "https://arxiv.org/html/2401.00004",
      pdfUrl: null,
      status: "discovered" as const,
      discoveredAt: new Date(),
      updatedAt: new Date(),
    } satisfies Paper;

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("<html><body><p>HTML  full  text</p></body></html>", {
        status: 200,
      })) as unknown as typeof fetch;
    try {
      expect(await fetchArxivFullText(paper)).toBe("HTML full text");
    } finally {
      globalThis.fetch = realFetch;
    }

    // No HTML source -> abstract fallback (no network).
    expect(await fetchArxivFullText({ ...paper, fullTextUrl: null })).toBe("the stored abstract");
  });

  // Default fetcher — strips arXiv (ar5iv) page chrome: the theme <script> body,
  // <style>, and the ToC <nav> must not survive as text; the article body must.
  test("default fetcher strips script/style/nav chrome from arXiv HTML, keeping article text", async () => {
    const paper = {
      arxivId: "2401.00004",
      title: "t",
      authors: ["a"],
      abstract: "the stored abstract",
      sourceUrl: "https://arxiv.org/abs/2401.00004",
      fullTextUrl: "https://arxiv.org/html/2401.00004",
      pdfUrl: null,
      status: "discovered" as const,
      discoveredAt: new Date(),
      updatedAt: new Date(),
    } satisfies Paper;

    const ar5iv =
      "<html><head>" +
      '<script>const t = localStorage.getItem("ar5iv_theme"); document.title;</script>' +
      "<style>body{color:red}</style></head>" +
      '<body><nav class="ltx_TOC">1 Introduction 2 Background 3 Methods</nav>' +
      "<article><h1>Real Title</h1><p>The transformer uses self&#39;attention &amp; layers.</p></article>" +
      "</body></html>";

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(ar5iv, { status: 200 })) as unknown as typeof fetch;
    try {
      const text = await fetchArxivFullText(paper);
      expect(text).toContain("The transformer uses self'attention & layers.");
      expect(text).toContain("Real Title");
      expect(text).not.toContain("localStorage"); // script body gone
      expect(text).not.toContain("color:red"); // style body gone
      expect(text).not.toContain("1 Introduction"); // ToC nav gone
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
