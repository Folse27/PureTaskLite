import { SESSION_COOKIE } from "@/lib/auth/session";
import { route } from "@/lib/server/http";

export const POST = route(async () => {
  const response = Response.json({ ok: true });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`);
  return response;
});
