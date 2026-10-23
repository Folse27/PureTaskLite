import "server-only";
import { z, ZodError, type ZodType } from "zod";
import { DepthLimitError } from "@/lib/depth";
import { sessionSecret } from "@/lib/auth/secret";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = "Task") => new HttpError(404, `${what} not found.`);

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  return schema.parse(body);
}

export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(new URL(request.url).searchParams));
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Postgres errors we can explain to the client instead of returning a 500. */
function pgErrorToHttp(error: unknown): HttpError | null {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const code = (cause as { code?: string })?.code;
  if (code === "23503") return new HttpError(400, "Referenced status, priority or task does not exist.");
  if (code === "23514") return new HttpError(400, "That change would break the sub-note depth limit.");
  if (code === "22P02") return new HttpError(400, "Invalid identifier.");
  return null;
}

type Handler<C> = (request: Request, context: C) => Promise<Response>;

/**
 * Wraps a route handler: re-checks the session (defence in depth — the proxy
 * already blocks unauthenticated requests) and maps errors to JSON responses.
 */
export function route<C>(handler: Handler<C>, options: { public?: boolean } = {}): Handler<C> {
  return async (request, context) => {
    try {
      if (!options.public) {
        const ok = await verifySessionToken(readCookie(request, SESSION_COOKIE), sessionSecret());
        if (!ok) return Response.json({ error: "Not signed in." }, { status: 401 });
      }
      const response = await handler(request, context);
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ error: error.message, ...error.extra }, { status: error.status });
      }
      if (error instanceof ZodError) {
        return Response.json({ error: "Invalid input.", issues: z.flattenError(error) }, { status: 400 });
      }
      if (error instanceof DepthLimitError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      const mapped = pgErrorToHttp(error);
      if (mapped) return Response.json({ error: mapped.message }, { status: mapped.status });
      console.error(`[api] ${request.method} ${new URL(request.url).pathname} failed:`, error);
      return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}
