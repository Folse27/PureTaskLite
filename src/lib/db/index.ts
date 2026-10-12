import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, databaseUrl } from "./connection";
import * as schema from "./schema";

type Db = ReturnType<typeof createDb>;

function createDb() {
  return drizzle(createSqlClient(databaseUrl()), { schema });
}

// Reuse one client per serverless instance (and across dev hot reloads).
const globalForDb = globalThis as unknown as { __ptlDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__ptlDb) globalForDb.__ptlDb = createDb();
  return globalForDb.__ptlDb;
}

export type Database = Db;
export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
