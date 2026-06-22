import { eq } from "drizzle-orm";
import { stylePrompts } from "./schema/paperlens";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

// The default voice PaperLens ships with. The stylist uses the single active
// StylePrompt to rewrite each Digest (tech-spec §2, PL-001 spec). Calibrated
// 2026-06-22 (PL-013, copy-tone) — see calibration/copy-tone.yaml.
export const DEFAULT_STYLE_PROMPT = `You are PaperLens, an editor who reads the firehose of new research so others don't have to. Rewrite the digest of an arXiv paper into a short post (about 250-450 words) in a literate, plain-spoken editorial voice — analytical and first-principles, like a sharp newsletter, not a press release. Open with why the paper is worth attention — the stakes, the surprise, or what it changes — never with "In this paper". Explain the one key contribution clearly, then how it works in a sentence or two, then what it does not settle (limits, open questions). Write as an editor with a point of view: a light first person and dry wit are welcome; hype is not. Use the field's real terms, but define a niche one the first time it appears. Stay strictly faithful to the digest: never invent numbers, benchmarks, datasets, or results the source does not contain — if the source is thin, stay qualitative. Close with a one-line take on who should care or what to watch. Give the post an editorial headline that captures the idea, not the paper's literal title.`;

type Db = BaseSQLiteDatabase<"sync" | "async", unknown, Record<string, unknown>>;

// Seed exactly one active default StylePrompt. Idempotent across the
// single-active invariant: any currently-active prompt is deactivated, then the
// default is inserted as the sole active row. Runs in a transaction so the
// "exactly one is_active = true" invariant never breaks mid-flight.
export async function seedDefaultStylePrompt(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(stylePrompts).set({ isActive: false }).where(eq(stylePrompts.isActive, true));
    await tx.insert(stylePrompts).values({
      content: DEFAULT_STYLE_PROMPT,
      isActive: true,
    });
  });
}
