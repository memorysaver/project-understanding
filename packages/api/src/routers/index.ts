import { protectedProcedure, publicProcedure } from "../index";
import { getPost, listPosts } from "./posts";
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
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
