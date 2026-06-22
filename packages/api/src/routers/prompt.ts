import { ORPCError } from "@orpc/server";
import { z } from "zod";
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

// updateActivePrompt — persist new content for the active StylePrompt, keeping
// exactly one active prompt. Updates the active row's content in place inside a
// single transaction, so the PL-001 single-active invariant (exactly one
// is_active = true) is never violated — no second active row is ever created.
export const updateActivePrompt = protectedProcedure
  .input(z.object({ content: z.string().min(1) }))
  .handler(async ({ context, input }) => {
    return context.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(stylePrompts)
        .set({ content: input.content })
        .where(eq(stylePrompts.isActive, true))
        .returning({ id: stylePrompts.id, content: stylePrompts.content });

      if (!updated) {
        throw new ORPCError("NOT_FOUND", { message: "No active style prompt" });
      }

      return updated;
    });
  });
