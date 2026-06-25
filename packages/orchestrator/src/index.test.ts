/// <reference types="bun" />
import { expect, test, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { and, eq } from "drizzle-orm";
import * as schema from "@paperlens/db/schema/index";
import { ARXIV_ATOM_FIXTURE, FIXTURE_ID } from "@paperlens/crawler/fixtures";
import type { CrawlerDb, FetchLike } from "@paperlens/crawler";
import type { complete as Complete } from "@paperlens/llm";
import {
  enqueueDiscovery,
  handleDiscover,
  handleDigest,
  handleStyle,
  handlePublish,
  dispatch,
  parsePipelineMessage,
  type PipelineMessage,
  type PipelineDeps,
  type QueueProducer,
} from "./index";

// In-memory SQLite with the real PL-001 migration applied. D1 and bun-sqlite
// share the SQLite dialect, so the same migration SQL + Drizzle defs exercise
// the real schema offline (mirrors packages/db/src/paperlens.test.ts).
async function makeDb(): Promise<BunSQLiteDatabase<typeof schema>> {
  const sqlite = new Database(":memory:");
  sqlite.run("PRAGMA foreign_keys = ON");
  for (const file of ["0000_keen_supernaut.sql", "0001_far_edwin_jarvis.sql"]) {
    const migrationUrl = new URL(
      `../migrations/${file}`,
      import.meta.resolve("@paperlens/db/schema/index"),
    );
    const migration = await Bun.file(migrationUrl).text();
    for (const statement of migration.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.run(trimmed);
    }
  }
  return drizzle(sqlite, { schema });
}

// A fake queue producer: records every enqueued message instead of delivering.
function fakeQueue() {
  const sent: PipelineMessage[] = [];
  const queue: QueueProducer = {
    send: async (message) => void sent.push(message),
  };
  return { queue, sent };
}

// A fixture-backed arXiv metadata fetcher — returns the canned Atom feed.
const fixtureFetcher: FetchLike = async () => ({
  ok: true,
  status: 200,
  text: async () => ARXIV_ATOM_FIXTURE,
});

const CANNED_DIGEST = {
  contributions: ["Proposes a retrieval-augmented long-context method."],
  methods: ["Trains on multi-hop reasoning benchmarks."],
  results: ["Consistent gains on multi-hop reasoning."],
};
const STYLED_BODY = "<p>This paper shows retrieval helps long-context reasoning.</p>";

// A single mocked llm `complete` serving both stages offline: digest (schema →
// json) and style (no schema → text). Counts calls so we can pin "≤1 LLM call".
function mockComplete() {
  let calls = 0;
  const fn = ((args: Parameters<typeof Complete>[0]) => {
    calls += 1;
    const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
    if (args.schema) return Promise.resolve({ json: CANNED_DIGEST, model: "mock/digest", usage });
    return Promise.resolve({ content: STYLED_BODY, model: "mock/style", usage });
  }) as typeof Complete;
  return { fn, calls: () => calls };
}

// Offline deps for the handlers: in-memory db, fake queue, fixture fetchers,
// mocked llm, and a single-paper seed so discover fans out deterministically.
function makeDeps(
  db: CrawlerDb,
  queue: QueueProducer,
  complete: typeof Complete,
  seed: string[] = [FIXTURE_ID],
): PipelineDeps {
  return {
    db,
    queue,
    complete,
    fetcher: fixtureFetcher,
    fetchFullText: async () => "Full text of the fixture paper for digestion.",
    seed,
  };
}

const OK = { attempt: 1, maxRetries: 3 } as const;

describe("PL-018 orchestrator — enqueueDiscovery (producer)", () => {
  test("creates a Run and enqueues exactly one discover message", async () => {
    const db = await makeDb();
    const { queue, sent } = fakeQueue();

    const { runId } = await enqueueDiscovery("manual", { db, queue });

    const runRows = await db.select().from(schema.runs);
    expect(runRows).toHaveLength(1);
    expect(runRows[0]!.trigger).toBe("manual");
    expect(runRows[0]!.id).toBe(runId);
    expect(sent).toEqual([{ type: "discover", runId }]);
  });
});

describe("PL-018 orchestrator — 3.1 discover fan-out", () => {
  test("enqueues exactly one digest message per new paper", async () => {
    const db = await makeDb();
    const { queue, sent } = fakeQueue();
    const llm = mockComplete();

    await handleDiscover(
      { type: "discover", runId: "run-1" },
      makeDeps(db, queue, llm.fn, [FIXTURE_ID]),
    );

    // One Paper persisted (discovered) and exactly one digest message, carrying
    // the paper's arxiv_id + runId, no arxiv_id missing.
    expect(await db.select().from(schema.papers)).toHaveLength(1);
    expect(sent).toEqual([{ type: "digest", arxiv_id: FIXTURE_ID, runId: "run-1" }]);
    // discover itself makes no LLM call.
    expect(llm.calls()).toBe(0);
  });
});

describe("PL-018 orchestrator — 6.1 state transitions", () => {
  // Walk a single paper through digest → style → publish, asserting each
  // transition + the next message enqueued + the one-LLM-call-per-message budget.
  test("digest advances discovered → digested and enqueues style (one LLM call)", async () => {
    const db = await makeDb();
    const { queue, sent } = fakeQueue();
    const llm = mockComplete();
    const deps = makeDeps(db, queue, llm.fn);
    await handleDiscover({ type: "discover", runId: "r" }, deps);
    sent.length = 0;

    await handleDigest({ type: "digest", arxiv_id: FIXTURE_ID, runId: "r" }, deps);

    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, FIXTURE_ID))
    )[0]!;
    expect(paper.status).toBe("digested");
    expect(await db.select().from(schema.digests)).toHaveLength(1);
    expect(sent).toEqual([{ type: "style", arxiv_id: FIXTURE_ID, runId: "r" }]);
    expect(llm.calls()).toBe(1); // digest = exactly one llm call
  });

  test("style advances digested → styled, persists a draft Post, enqueues publish (one LLM call)", async () => {
    const db = await makeDb();
    const { queue, sent } = fakeQueue();
    const llm = mockComplete();
    const deps = makeDeps(db, queue, llm.fn);
    await handleDiscover({ type: "discover", runId: "r" }, deps);
    await handleDigest({ type: "digest", arxiv_id: FIXTURE_ID, runId: "r" }, deps);
    sent.length = 0;
    const before = llm.calls();

    await handleStyle({ type: "style", arxiv_id: FIXTURE_ID, runId: "r" }, deps);

    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, FIXTURE_ID))
    )[0]!;
    expect(paper.status).toBe("styled");
    // The styled body lives in a single draft Post (the style intermediate).
    const drafts = await db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.paperId, FIXTURE_ID), eq(schema.posts.status, "draft")));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toBe(STYLED_BODY);
    expect(sent).toEqual([{ type: "publish", arxiv_id: FIXTURE_ID, runId: "r" }]);
    expect(llm.calls() - before).toBe(1); // style = exactly one llm call
  });

  test("publish advances styled → published (terminal, no LLM call, no next message)", async () => {
    const db = await makeDb();
    const { queue, sent } = fakeQueue();
    const llm = mockComplete();
    const deps = makeDeps(db, queue, llm.fn);
    await handleDiscover({ type: "discover", runId: "r" }, deps);
    await handleDigest({ type: "digest", arxiv_id: FIXTURE_ID, runId: "r" }, deps);
    await handleStyle({ type: "style", arxiv_id: FIXTURE_ID, runId: "r" }, deps);
    sent.length = 0;
    const before = llm.calls();

    await handlePublish({ type: "publish", arxiv_id: FIXTURE_ID, runId: "r" }, deps);

    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, FIXTURE_ID))
    )[0]!;
    expect(paper.status).toBe("published");
    const published = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.status, "published"));
    expect(published).toHaveLength(1);
    expect(published[0]!.publishedAt).not.toBeNull();
    expect(published[0]!.title).toBe("Attention & Retrieval: A Study of Long-Context Reasoning");
    expect(published[0]!.citation).toContain(`arXiv:${FIXTURE_ID}`);
    // Still exactly one Post per paper (draft finalized in place).
    expect(await db.select().from(schema.posts)).toHaveLength(1);
    expect(sent).toEqual([]); // terminal — nothing enqueued
    expect(llm.calls() - before).toBe(0); // publish = zero llm calls
  });
});

describe("PL-018 orchestrator — 6.2 idempotent stage re-run", () => {
  test("a redelivered digest overwrites the Digest in place, does not regress or redo, re-enqueues style", async () => {
    const db = await makeDb();
    const { queue, sent } = fakeQueue();
    const llm = mockComplete();
    const deps = makeDeps(db, queue, llm.fn);
    await handleDiscover({ type: "discover", runId: "r" }, deps);
    await handleDigest({ type: "digest", arxiv_id: FIXTURE_ID, runId: "r" }, deps);
    const callsAfterFirstDigest = llm.calls();
    sent.length = 0;

    // Redeliver the digest message for the already-digested paper.
    await handleDigest({ type: "digest", arxiv_id: FIXTURE_ID, runId: "r" }, deps);

    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, FIXTURE_ID))
    )[0]!;
    expect(paper.status).toBe("digested"); // not regressed, not advanced past
    expect(await db.select().from(schema.digests)).toHaveLength(1); // still one Digest
    expect(await db.select().from(schema.posts)).toHaveLength(0); // no later-stage work redone
    expect(sent).toEqual([{ type: "style", arxiv_id: FIXTURE_ID, runId: "r" }]); // style re-enqueued
    expect(llm.calls()).toBe(callsAfterFirstDigest); // digestor NOT re-run (no extra llm call)
  });

  test("a full re-delivery of every stage produces no duplicate Paper/Digest/Post", async () => {
    const db = await makeDb();
    const { queue } = fakeQueue();
    const llm = mockComplete();
    const deps = makeDeps(db, queue, llm.fn);
    const msgs: PipelineMessage[] = [
      { type: "discover", runId: "r" },
      { type: "digest", arxiv_id: FIXTURE_ID, runId: "r" },
      { type: "style", arxiv_id: FIXTURE_ID, runId: "r" },
      { type: "publish", arxiv_id: FIXTURE_ID, runId: "r" },
    ];
    for (const m of msgs) await dispatch(m, deps, OK);
    for (const m of msgs) await dispatch(m, deps, OK); // redeliver everything

    expect(await db.select().from(schema.papers)).toHaveLength(1);
    expect(await db.select().from(schema.digests)).toHaveLength(1);
    expect(await db.select().from(schema.posts)).toHaveLength(1);
    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, FIXTURE_ID))
    )[0]!;
    expect(paper.status).toBe("published");
  });

  // Resume-from-stage robustness: a partial style run (status advanced to `styled`
  // by the stylist, but the orchestrator crashed before writing the draft Post)
  // must resume — a redelivered style re-runs the stylist and writes the draft,
  // and publish then succeeds. The guard keys on the intermediate, not the status.
  test("a styled paper missing its draft Post re-runs the stylist on redelivery (resume), then publishes", async () => {
    const db = await makeDb();
    const { queue, sent } = fakeQueue();
    const llm = mockComplete();
    const deps = makeDeps(db, queue, llm.fn);
    await handleDiscover({ type: "discover", runId: "r" }, deps);
    await handleDigest({ type: "digest", arxiv_id: FIXTURE_ID, runId: "r" }, deps);
    await handleStyle({ type: "style", arxiv_id: FIXTURE_ID, runId: "r" }, deps);

    // Simulate the crash window: status is `styled` but the draft Post is gone.
    await db.delete(schema.posts).where(eq(schema.posts.paperId, FIXTURE_ID));
    const paperBefore = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, FIXTURE_ID))
    )[0]!;
    expect(paperBefore.status).toBe("styled");
    sent.length = 0;

    // Redeliver style: it must re-create the draft (not skip on status), then publish.
    await handleStyle({ type: "style", arxiv_id: FIXTURE_ID, runId: "r" }, deps);
    const drafts = await db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.paperId, FIXTURE_ID), eq(schema.posts.status, "draft")));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toBe(STYLED_BODY);
    expect(sent).toEqual([{ type: "publish", arxiv_id: FIXTURE_ID, runId: "r" }]);

    await handlePublish({ type: "publish", arxiv_id: FIXTURE_ID, runId: "r" }, deps);
    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, FIXTURE_ID))
    )[0]!;
    expect(paper.status).toBe("published");
    expect(await db.select().from(schema.posts)).toHaveLength(1);
  });
});

describe("PL-018 orchestrator — 6.3 failure after max retries", () => {
  test("a stage exhausting max_retries marks the Paper failed, records it on the Run, enqueues nothing", async () => {
    const db = await makeDb();
    const { queue, sent } = fakeQueue();
    // A Run for the failure to be recorded against, and a discovered Paper to fail on.
    await db.insert(schema.runs).values({ id: "run-x", trigger: "manual", status: "running" });
    await handleDiscover(
      { type: "discover", runId: "run-x" },
      makeDeps(db, queue, mockComplete().fn),
    );
    sent.length = 0;

    // An llm that always throws → the digest stage fails on every delivery.
    const failing = (() => Promise.reject(new Error("llm down"))) as typeof Complete;
    const failDeps: PipelineDeps = {
      db,
      queue,
      complete: failing,
      fetchFullText: async () => "full text",
    };

    // Within budget (attempt 1..3): rethrows so the queue retries.
    await expect(
      dispatch({ type: "digest", arxiv_id: FIXTURE_ID, runId: "run-x" }, failDeps, {
        attempt: 1,
        maxRetries: 3,
      }),
    ).rejects.toThrow("llm down");

    // Exhausted (attempt 4 > maxRetries 3): swallow + mark failed.
    await dispatch({ type: "digest", arxiv_id: FIXTURE_ID, runId: "run-x" }, failDeps, {
      attempt: 4,
      maxRetries: 3,
    });

    const paper = (
      await db.select().from(schema.papers).where(eq(schema.papers.arxivId, FIXTURE_ID))
    )[0]!;
    expect(paper.status).toBe("failed");
    const run = (await db.select().from(schema.runs).where(eq(schema.runs.id, "run-x")))[0]!;
    expect(run.status).toBe("failed");
    expect(run.stats?.failed).toBeGreaterThanOrEqual(1);
    expect(sent).toEqual([]); // no next stage enqueued
  });
});

describe("PL-018 orchestrator — 6.4 queue message shape (contract)", () => {
  test("discover omits arxiv_id; digest/style/publish carry it; all round-trip through the dispatch", async () => {
    const db = await makeDb();
    const { queue, sent } = fakeQueue();
    const llm = mockComplete();
    const deps = makeDeps(db, queue, llm.fn);

    // Drive a paper through the pipeline via dispatch (the consumer's routing).
    await dispatch({ type: "discover", runId: "r" }, deps, OK);
    const discoverOut = sent[0]!;
    // discover fans out a digest message: { type, arxiv_id, runId }.
    expect(discoverOut.type).toBe("digest");
    expect(discoverOut).toHaveProperty("arxiv_id", FIXTURE_ID);
    expect(discoverOut.runId).toBe("r");

    await dispatch({ type: "digest", arxiv_id: FIXTURE_ID, runId: "r" }, deps, OK);
    await dispatch({ type: "style", arxiv_id: FIXTURE_ID, runId: "r" }, deps, OK);

    // Every enqueued message validates against the contract via parsePipelineMessage.
    for (const m of sent) {
      expect(parsePipelineMessage(m)).toEqual(m);
    }

    // The discover message itself has no arxiv_id (round-trips, stripped).
    expect(parsePipelineMessage({ type: "discover", runId: "r", arxiv_id: undefined })).toEqual({
      type: "discover",
      runId: "r",
    });
    // A downstream message missing arxiv_id is rejected.
    expect(parsePipelineMessage({ type: "digest", runId: "r" })).toBeNull();
    // An unknown type is rejected.
    expect(parsePipelineMessage({ type: "nope", runId: "r" })).toBeNull();
  });
});

describe("PL-018 orchestrator — 6.5 integration (batch through the wired dispatch)", () => {
  test("a discovery enqueue, driven through the dispatch, publishes a batch of papers", async () => {
    const db = await makeDb();
    const { queue, sent } = fakeQueue();
    const llm = mockComplete();
    // A 3-paper seed (the fixture fetcher returns the same metadata; the crawler
    // keys the Paper by the *requested* id, so each seed id yields a distinct row).
    const seed = ["2401.10001", "2401.10002", "2401.10003"];
    const deps = makeDeps(db, queue, llm.fn, seed);

    // enqueueDiscovery → drain the queue through dispatch until empty (one batch,
    // wired end to end with a mocked llm + fixture fetchers).
    const { runId } = await enqueueDiscovery("manual", deps);
    while (sent.length > 0) {
      const message = sent.shift()!;
      await dispatch(message, deps, OK);
    }

    // All three papers reached published, each with exactly one published Post.
    const published = await db
      .select()
      .from(schema.posts)
      .where(eq(schema.posts.status, "published"));
    expect(published).toHaveLength(seed.length);
    const papers = await db.select().from(schema.papers);
    expect(papers).toHaveLength(seed.length);
    expect(papers.every((p) => p.status === "published")).toBe(true);
    expect(runId).toBeString();
  });
});
