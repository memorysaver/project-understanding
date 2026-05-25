import * as schema from "./schema";
import { drizzle } from "drizzle-orm/d1";
import { env } from "@paperlens/env/server";

export function createDb() {
  return drizzle(env.DB, { schema });
}
