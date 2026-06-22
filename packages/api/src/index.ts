import { ORPCError, os } from "@orpc/server";
import type { Context } from "./context";

export const o = os.$context<Context>();

// Reader (public) surface — no auth gate. listPosts/getPost build on this.
export const publicProcedure = o;

// Auth gate for the console (curation) surface. Fails closed: any call without
// an owner session is rejected with a 401 (ORPCError "UNAUTHORIZED" → status 401)
// before the handler runs, matching the web → api contract. Console routers
// (getActivePrompt/updateActivePrompt, triggerRun, setPostStatus, previewRewrite)
// compose on protectedProcedure.
const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized console call" });
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);
