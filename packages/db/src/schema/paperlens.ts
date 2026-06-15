import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Paper lifecycle: discovered -> digested -> styled -> published, plus failed.
// See docs/technical-spec.md §3 (Paper state machine).
export const paperStatuses = ["discovered", "digested", "styled", "published", "failed"] as const;
export type PaperStatus = (typeof paperStatuses)[number];

// Post lifecycle states (tech-spec §2). published is terminal-happy; the owner
// may move a published post to unpublished from the console.
export const postStatuses = ["draft", "unpublished", "published"] as const;
export type PostStatus = (typeof postStatuses)[number];

// Run trigger + status enums (tech-spec §2).
export const runTriggers = ["manual", "cron"] as const;
export type RunTrigger = (typeof runTriggers)[number];

export const runStatuses = ["running", "done", "failed"] as const;
export type RunStatus = (typeof runStatuses)[number];

// Per-pipeline-run stats recorded by the orchestrator (tech-spec §2).
export type RunStats = {
  discovered: number;
  digested: number;
  styled: number;
  published: number;
  failed: number;
};

// Paper — arxiv_id is the dedup key (PRIMARY KEY). Inserts use
// INSERT ... ON CONFLICT DO NOTHING so the same paper is never stored twice.
export const papers = sqliteTable("papers", {
  arxivId: text("arxiv_id").primaryKey(),
  title: text("title").notNull(),
  authors: text("authors", { mode: "json" }).$type<string[]>().notNull(),
  abstract: text("abstract").notNull(),
  sourceUrl: text("source_url").notNull(),
  fullTextUrl: text("full_text_url"),
  pdfUrl: text("pdf_url"),
  status: text("status", { enum: paperStatuses }).default("discovered").notNull(),
  discoveredAt: integer("discovered_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

// Digest — per-paper structured digest produced by the digestor stage.
// Invariant: at most one current Digest per Paper (tech-spec §2).
export const digests = sqliteTable(
  "digests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.arxivId, { onDelete: "cascade" }),
    contributions: text("contributions", { mode: "json" }).$type<string[]>().notNull(),
    methods: text("methods", { mode: "json" }).$type<string[]>().notNull(),
    results: text("results", { mode: "json" }).$type<string[]>().notNull(),
    rawJson: text("raw_json", { mode: "json" }),
    model: text("model").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("digests_paperId_idx").on(table.paperId)],
);

// StylePrompt — the voice/style instruction used by the stylist stage.
// Invariant (MVP): exactly one row with is_active = true. Updating the active
// prompt is a transactional flip (tech-spec §2). One default is seeded.
export const stylePrompts = sqliteTable("style_prompts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  content: text("content").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

// Post — the published-facing article assembled by the publisher stage.
// Invariant: a Post with status `published` has a non-null published_at
// (enforced in the app/publisher layer; tech-spec §2).
export const posts = sqliteTable(
  "posts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    paperId: text("paper_id")
      .notNull()
      .references(() => papers.arxivId, { onDelete: "cascade" }),
    digestId: text("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    stylePromptId: text("style_prompt_id")
      .notNull()
      .references(() => stylePrompts.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    citation: text("citation").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    status: text("status", { enum: postStatuses }).default("draft").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    model: text("model").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("posts_paperId_idx").on(table.paperId),
    index("posts_status_idx").on(table.status),
  ],
);

// Run — one pipeline run (manual or cron) with aggregate stage counts.
export const runs = sqliteTable("runs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  trigger: text("trigger", { enum: runTriggers }).notNull(),
  status: text("status", { enum: runStatuses }).default("running").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  stats: text("stats", { mode: "json" }).$type<RunStats>(),
});
