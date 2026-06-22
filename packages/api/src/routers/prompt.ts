import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { stylePrompts } from "@paperlens/db/schema/paperlens";
import { protectedProcedure } from "../index";

// Console (auth-gated) procedures for the single active StylePrompt — the
// owner's define-voice activity (PL-015). Both compose on protectedProcedure
// (PL-014): an unauthenticated call is rejected with 401 before the handler
// runs, so prompt state is never read or mutated. Reuses the PL-001
// single-active invariant (exactly one is_active = true).

// getActivePrompt — return the single active StylePrompt's id + content.
export const getActivePrompt = protectedProcedure.handler(async ({ context }) => {
  const [prompt] = await context.db
    .select({ id: stylePrompts.id, content: stylePrompts.content })
    .from(stylePrompts)
    .where(eq(stylePrompts.isActive, true))
    .limit(1);

  if (!prompt) {
    throw new ORPCError("NOT_FOUND", { message: "No active style prompt" });
  }

  return prompt;
});
