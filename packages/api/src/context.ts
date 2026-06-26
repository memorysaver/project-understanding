import type { Context as HonoContext } from "hono";
import { getSession } from "@paperlens/auth";
import { createDb } from "@paperlens/db";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "@paperlens/db/schema/paperlens";
import type { QueueProducer } from "@paperlens/orchestrator";

// The Drizzle handle the routers query through. Typed broadly over the SQLite
// dialect so the prod D1 database and an in-memory bun:sqlite test database
// (same dialect, same schema) both satisfy it.
export type Db = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema>;

export type CreateContextOptions = {
  context: HonoContext;
};

export type Context = {
  auth: null;
  session: Awaited<ReturnType<typeof getSession>>;
  db: Db;
  // The pipeline queue producer triggerRun (PL-020) passes to the orchestrator's
  // enqueueDiscovery — the injection seam mirroring db/session. Optional: in
  // production it is left absent so enqueueDiscovery lazily binds the real
  // PIPELINE_QUEUE (no new binding plumbing in the api); tests inject a recording
  // fake.
  queue?: QueueProducer;
};

export async function createContext({ context }: CreateContextOptions): Promise<Context> {
  const session = await getSession(context.req.raw.headers);
  return {
    auth: null,
    session,
    db: createDb() as Db,
  };
}
