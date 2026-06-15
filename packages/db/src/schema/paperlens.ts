import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
