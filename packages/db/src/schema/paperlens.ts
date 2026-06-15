import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Paper lifecycle: discovered -> digested -> styled -> published, plus failed.
// See docs/technical-spec.md §3 (Paper state machine).
export const paperStatuses = ["discovered", "digested", "styled", "published", "failed"] as const;
export type PaperStatus = (typeof paperStatuses)[number];

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
