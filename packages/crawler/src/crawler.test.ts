/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "@paperlens/db/schema/index";
import { fetchById } from "./index";
import { parseArxivAtom, USER_AGENT } from "./arxiv";
import { ARXIV_ATOM_FIXTURE, ARXIV_EMPTY_FIXTURE, FIXTURE_ID } from "./fixtures";
import type { FetchLike } from "./types";

// Build an in-memory SQLite db with the @paperlens/db D1 migration applied — the
// same pattern PL-001 used in packages/db. D1 and bun-sqlite share the SQLite
// dialect, so the real schema is exercised without a Cloudflare binding. The
// migration is resolved through the db package so this test does not hardcode
// the migration filename.
async function makeDb(): Promise<BunSQLiteDatabase<typeof schema>> {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  const migrationUrl = new URL(
    "../migrations/0000_keen_supernaut.sql",
    import.meta.resolve("@paperlens/db/schema/index"),
  );
  const migration = await Bun.file(migrationUrl).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.run(trimmed);
  }
  return drizzle(sqlite, { schema });
}

// A fixture-backed fetcher. Records the requests it received so tests can assert
// the URL and User-Agent, and returns the supplied Atom body. No real network.
function fixtureFetcher(body: string, ok = true, status = 200) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetcher: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    return { ok, status, text: async () => body };
  };
  return { fetcher, calls };
}

// --- Unit: metadata mapping ------------------------------------------------

describe("arXiv metadata mapping", () => {
  test("maps title, abstract, authors and derives the three URLs", () => {
    const meta = parseArxivAtom(ARXIV_ATOM_FIXTURE, FIXTURE_ID);

    expect(meta.arxivId).toBe(FIXTURE_ID);
    // Wrapped whitespace collapsed and the `&amp;` entity decoded.
    expect(meta.title).toBe("Attention & Retrieval: A Study of Long-Context Reasoning");
    expect(meta.abstract).toBe(
      "We investigate how retrieval augmentation interacts with long-context attention in large language models. Our experiments show consistent gains on multi-hop reasoning benchmarks.",
    );
    expect(meta.authors).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(meta.sourceUrl).toBe(`https://arxiv.org/abs/${FIXTURE_ID}`);
    expect(meta.fullTextUrl).toBe(`https://arxiv.org/html/${FIXTURE_ID}`);
    expect(meta.pdfUrl).toBe(`https://arxiv.org/pdf/${FIXTURE_ID}`);
  });

  test("throws for an empty feed (unknown id)", () => {
    expect(() => parseArxivAtom(ARXIV_EMPTY_FIXTURE, "0000.00000")).toThrow();
  });
});

// --- Integration: fetch + persist (AC 1) -----------------------------------

describe("fetchById persists a discovered Paper (AC 1)", () => {
  test("a known arXiv id persists a Paper with title, abstract, source_url, full_text_url", async () => {
    const db = await makeDb();
    const { fetcher, calls } = fixtureFetcher(ARXIV_ATOM_FIXTURE);

    const paper = await fetchById({ id: FIXTURE_ID, db, fetcher });

    // Returned row.
    expect(paper.arxivId).toBe(FIXTURE_ID);
    expect(paper.title).toBe("Attention & Retrieval: A Study of Long-Context Reasoning");
    expect(paper.abstract).toContain("retrieval augmentation");
    expect(paper.sourceUrl).toBe(`https://arxiv.org/abs/${FIXTURE_ID}`);
    expect(paper.fullTextUrl).toBe(`https://arxiv.org/html/${FIXTURE_ID}`);
    // New Papers default to `discovered`.
    expect(paper.status).toBe("discovered");

    // Row actually exists in the db.
    const rows = await db.select().from(schema.papers);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe(paper.title);
    expect(rows[0]!.fullTextUrl).toBe(`https://arxiv.org/html/${FIXTURE_ID}`);

    // arXiv etiquette: the request went to the API with the custom User-Agent.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(`id_list=${FIXTURE_ID}`);
    expect(calls[0]!.headers?.["User-Agent"]).toBe(USER_AGENT);
  });
});

// --- Unit/Integration: dedup on re-fetch (AC 2) ----------------------------

describe("dedup on re-fetch (AC 2)", () => {
  test("re-fetching the same id does not create a duplicate Paper", async () => {
    const db = await makeDb();
    const { fetcher } = fixtureFetcher(ARXIV_ATOM_FIXTURE);

    const first = await fetchById({ id: FIXTURE_ID, db, fetcher });
    const second = await fetchById({ id: FIXTURE_ID, db, fetcher });

    const rows = await db.select().from(schema.papers);
    expect(rows).toHaveLength(1);
    // Same row returned both times (dedup keyed on arxiv_id).
    expect(first.arxivId).toBe(second.arxivId);
    expect(first.discoveredAt.getTime()).toBe(second.discoveredAt.getTime());
  });

  test("a second fetch returning different metadata does NOT overwrite the stored Paper", async () => {
    const db = await makeDb();
    await fetchById({ id: FIXTURE_ID, db, fetcher: fixtureFetcher(ARXIV_ATOM_FIXTURE).fetcher });

    // Same id, but the feed now claims a different title — onConflictDoNothing
    // must keep the original row untouched.
    const mutated = ARXIV_ATOM_FIXTURE.replace(
      "Attention &amp; Retrieval: A Study of\n      Long-Context Reasoning",
      "A Completely Different Title",
    );
    await fetchById({ id: FIXTURE_ID, db, fetcher: fixtureFetcher(mutated).fetcher });

    const rows = await db.select().from(schema.papers);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Attention & Retrieval: A Study of Long-Context Reasoning");
  });
});

// --- Failure surface -------------------------------------------------------

describe("fetchById error handling", () => {
  test("a non-2xx arXiv response throws and persists nothing", async () => {
    const db = await makeDb();
    const { fetcher } = fixtureFetcher("", false, 503);

    await expect(fetchById({ id: FIXTURE_ID, db, fetcher })).rejects.toThrow();
    const rows = await db.select().from(schema.papers);
    expect(rows).toHaveLength(0);
  });

  test("the default fetcher is never invoked when one is injected", async () => {
    const db = await makeDb();
    const globalFetch = mock(() => {
      throw new Error("real network used");
    });
    const original = globalThis.fetch;
    // @ts-expect-error — swap global fetch to prove injection bypasses it.
    globalThis.fetch = globalFetch;
    try {
      const { fetcher } = fixtureFetcher(ARXIV_ATOM_FIXTURE);
      await fetchById({ id: FIXTURE_ID, db, fetcher });
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
