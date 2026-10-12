import postgres from "postgres";

/**
 * Reads the Postgres URL. DATABASE_URL is the documented name; POSTGRES_URL is
 * accepted as a fallback because the Vercel ↔ Supabase integration creates it.
 */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Use the Supabase *transaction pooler* connection string (port 6543).",
    );
  }
  return url;
}

/**
 * Creates a postgres-js client suited to Supabase's transaction pooler on
 * serverless: no prepared statements, few connections per instance.
 *
 * Query parameters are stripped from the URL (the integration adds things like
 * `supa=base-pooler.x` that postgres-js would forward to the server as startup
 * parameters); SSL is required for any non-local host.
 */
export function createSqlClient(url: string, options: { max?: number } = {}) {
  const parsed = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  parsed.search = "";
  return postgres(parsed.toString(), {
    prepare: false,
    max: options.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: local ? false : "require",
  });
}
