import { clientIp, hashIp, passwordMatches } from "@/lib/auth/credentials";
import { formatWait } from "@/lib/auth/rate-limit";
import { sessionSecret } from "@/lib/auth/secret";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";
import { parseBody, route } from "@/lib/server/http";
import { loginRateLimiter } from "@/lib/server/rate-limit-store";
import { loginInput } from "@/lib/validation";

function tooMany(retryAfterSeconds: number, scope: "ip" | "global") {
  const wait = formatWait(retryAfterSeconds);
  const error =
    scope === "global"
      ? `Login is temporarily paused after too many failed attempts. Try again in ${wait}.`
      : `Too many attempts. Try again in ${wait}.`;
  return Response.json(
    { error, retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export const POST = route(
  async (request) => {
    const expected = process.env.APP_PASSWORD;
    if (!expected) {
      console.error("[auth] APP_PASSWORD is not set.");
      return Response.json({ error: "Login is not configured on the server." }, { status: 500 });
    }

    const secret = sessionSecret();
    const ipHash = hashIp(clientIp(request.headers), secret);
    const limiter = loginRateLimiter();

    const limit = await limiter.check(ipHash);
    if (limit.limited) return tooMany(limit.retryAfterSeconds, limit.scope);

    const { password } = await parseBody(request, loginInput);

    if (!passwordMatches(password, expected)) {
      const result = await limiter.registerFailure(ipHash);
      if (result.limited) return tooMany(result.retryAfterSeconds, result.scope);
      return Response.json({ error: "Wrong password" }, { status: 401 });
    }

    await limiter.registerSuccess(ipHash);
    const response = Response.json({ ok: true });
    const token = await createSessionToken(secret);
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
    );
    return response;
  },
  { public: true },
);
