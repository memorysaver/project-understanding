import { protectedProcedure, publicProcedure } from "../index";
import { getPost, listPosts, setPostStatus } from "./posts";
import { getActivePrompt, updateActivePrompt } from "./prompt";
import { triggerRun } from "./run";
import type { RouterClient } from "@orpc/server";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),
  listPosts,
  getPost,
  setPostStatus,
  getActivePrompt,
  updateActivePrompt,
  triggerRun,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
