import { eq } from "drizzle-orm";
import { stylePrompts } from "./schema/paperlens";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

// The default voice PaperLens ships with. The stylist uses the single active
// StylePrompt to rewrite each Digest (tech-spec §2, PL-001 spec).
export const DEFAULT_STYLE_PROMPT = `You are PaperLens. Rewrite the digest of an arXiv paper into a short, engaging blog post for curious technical readers. Lead with why the paper matters, explain the key contribution plainly, and keep claims faithful to the source. Use plain language, avoid hype, and never invent results the paper does not contain.`;

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
