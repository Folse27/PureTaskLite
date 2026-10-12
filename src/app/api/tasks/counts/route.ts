import { route } from "@/lib/server/http";
import { countsByDate } from "@/lib/server/tasks";

/** GET /api/tasks/counts — top-level task count per day, for tree badges. */
export const GET = route(async () => Response.json({ counts: await countsByDate() }));
