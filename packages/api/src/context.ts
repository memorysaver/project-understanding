import type { Context as HonoContext } from "hono";
import { getSession } from "@paperlens/auth";
import { createDb } from "@paperlens/db";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "@paperlens/db/schema/paperlens";

// The Drizzle handle the routers query through. Typed broadly over the SQLite
// dialect so the prod D1 database and an in-memory bun:sqlite test database
// (same dialect, same schema) both satisfy it.
export type Db = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema>;

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const session = await getSession(context.req.raw.headers);
  return {
    auth: null,
    session,
    db: createDb() as Db,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
