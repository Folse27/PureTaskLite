/**
 * Applies pending Drizzle migrations from ./drizzle.
 *
 * Works through Supabase's transaction pooler (prepare: false, one connection).
 * Runs automatically on Vercel via the `vercel-build` script; if DATABASE_URL is
 * missing there (e.g. the very first deploy before the database is connected),
 * it skips with a warning instead of failing the build.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createSqlClient } from "../src/lib/db/connection";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    if (process.env.VERCEL) {
      console.warn("⚠ DATABASE_URL is not set — skipping migrations. Set it and redeploy.");
      return;
    }
    throw new Error("DATABASE_URL is not set (see .env.example).");
  }

  const sql = createSqlClient(url, { max: 1 });
  try {
    console.log("Applying migrations…");
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log("✓ Database is up to date.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("✗ Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
