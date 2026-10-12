import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { route } from "@/lib/server/http";

/**
 * Daily keep-alive, called by Vercel Cron (see vercel.json). Supabase pauses
 * free projects after ~7 days without activity; one small write a day keeps it
 * awake. Vercel sends `Authorization: Bearer $CRON_SECRET`.
 */
function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export const GET = route(
  async (request) => {
    if (!process.env.CRON_SECRET) {
      console.error("[cron] CRON_SECRET is not set; keep-alive is disabled.");
      return Response.json({ error: "Not configured." }, { status: 503 });
    }
    if (!authorized(request.headers.get("authorization"))) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.appMeta)
      .values({ key: "last_keepalive", value: now })
      .onConflictDoUpdate({ target: schema.appMeta.key, set: { value: sql`excluded.value` } });
    return Response.json({ ok: true, at: now });
  },
  { public: true },
);
