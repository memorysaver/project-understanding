/// <reference types="bun" />
import { expect, test, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import * as schema from "@paperlens/db/schema/index";
import { ARXIV_ATOM_FIXTURE, FIXTURE_ID } from "@paperlens/crawler/fixtures";
import type { FetchLike } from "@paperlens/crawler";
import type { complete as Complete } from "@paperlens/llm";
import { runOnce, type RunOnceDeps } from "./index";

// In-memory SQLite with the real PL-001 migration applied. D1 and bun-sqlite
// share the SQLite dialect, so the same migration SQL + Drizzle defs exercise
// the real schema offline (mirrors packages/db/src/paperlens.test.ts).
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

// A fixture-backed arXiv metadata fetcher — returns the canned Atom feed; no
// network. Counts calls so we can assert idempotency at the crawler boundary.
function fixtureFetcher() {
  let calls = 0;
  const fetcher: FetchLike = async () => {
    calls += 1;
    return { ok: true, status: 200, text: async () => ARXIV_ATOM_FIXTURE };
  };
  return { fetcher, calls: () => calls };
}

const CANNED_DIGEST = {
  contributions: ["Proposes a retrieval-augmented long-context method."],
  methods: ["Trains on multi-hop reasoning benchmarks."],
  results: ["Consistent gains on multi-hop reasoning."],
};

const STYLED_BODY = "<p>This paper shows retrieval helps long-context reasoning.</p>";

// A single mocked llm `complete` that serves both stages offline: the digest
// stage (schema supplied -> structured json) and the style stage (no schema ->
// text content). Asserts no network and the expected per-stage shape.
const mockComplete = ((args: Parameters<typeof Complete>[0]) => {
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
  if (args.schema) {
    expect(args.stage).toBe("digest");
    return Promise.resolve({ json: CANNED_DIGEST, model: "mock/digest", usage });
  }
  expect(args.stage).toBe("style");
  return Promise.resolve({ content: STYLED_BODY, model: "mock/style", usage });
}) as typeof Complete;

// Offline deps: in-memory db, fixture arXiv fetch, fixture full-text, mocked llm.
function makeDeps(db: BunSQLiteDatabase<typeof schema>, fetcher: FetchLike): RunOnceDeps {
  return {
    db,
    fetcher,
    fetchFullText: async () => "Full text of the fixture paper for digestion.",
    complete: mockComplete,
  };
}

describe("PL-007 orchestrator — L0 inline pipeline", () => {
  // AC1 — running the entrypoint on a hardcoded arXiv id yields a published Post.
  test("runOnce produces a published Post end-to-end (offline)", async () => {
    const db = await makeDb();
    const { fetcher } = fixtureFetcher();

    const post = await runOnce(FIXTURE_ID, makeDeps(db, fetcher));

    expect(post.status).toBe("published");
    expect(post.publishedAt).not.toBeNull();
    expect(post.paperId).toBe(FIXTURE_ID);
    expect(post.body).toBe(STYLED_BODY);
    // Title is carried from the discovered Paper's metadata.
    expect(post.title).toBe("Attention & Retrieval: A Study of Long-Context Reasoning");
    // Citation links back to the source paper.
    expect(post.citation).toContain(`arXiv:${FIXTURE_ID}`);
    expect(post.model).toBe("mock/style");

    // The Paper threaded all the way through the status machine to published.
    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, FIXTURE_ID))
    )[0]!;
    expect(paper.status).toBe("published");

    // Exactly one Post and one Paper exist.
    expect(await db.select().from(schema.posts)).toHaveLength(1);
    expect(await db.select().from(schema.papers)).toHaveLength(1);
  });

  // AC2 — a re-run does not duplicate the Paper or the Post (idempotent).
  test("a second runOnce adds no duplicate Paper or Post", async () => {
    const db = await makeDb();
    const { fetcher, calls } = fixtureFetcher();

    const first = await runOnce(FIXTURE_ID, makeDeps(db, fetcher));
    const second = await runOnce(FIXTURE_ID, makeDeps(db, fetcher));

    // Same published Post returned, no new rows.
    expect(second.id).toBe(first.id);
    expect(await db.select().from(schema.papers)).toHaveLength(1);
    expect(await db.select().from(schema.posts)).toHaveLength(1);
    // No duplicate Digest either.
    expect(await db.select().from(schema.digests)).toHaveLength(1);

    // The idempotency short-circuit means the crawler is not re-invoked on the
    // second run (the published Post is detected first).
    expect(calls()).toBe(1);
  });

  // The pipeline seeds the default StylePrompt when none is active, so a fresh
  // db (no seed) still runs end-to-end.
  test("runs against a fresh db with no pre-seeded StylePrompt", async () => {
    const db = await makeDb();
    const { fetcher } = fixtureFetcher();

    const before = await db.select().from(schema.stylePrompts);
    expect(before).toHaveLength(0);

    const post = await runOnce(FIXTURE_ID, makeDeps(db, fetcher));
    expect(post.status).toBe("published");

    // Exactly one active StylePrompt was seeded (single-active invariant).
    const active = await db
      .select()
      .from(schema.stylePrompts)
      .where(eq(schema.stylePrompts.isActive, true));
    expect(active).toHaveLength(1);
  });
});
