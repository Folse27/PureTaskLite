import { NextResponse, type NextRequest } from "next/server";
import { sessionSecret } from "@/lib/auth/secret";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * Blocks every page and API route without a valid session cookie.
 * (Next.js 16 renamed the `middleware` file convention to `proxy`.)
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  let authenticated = false;
  try {
    authenticated = await verifySessionToken(token, sessionSecret());
  } catch (error) {
    console.error("[auth]", error instanceof Error ? error.message : error);
  }

  if (pathname === "/login") {
    return authenticated ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Everything except the login endpoint, Next internals and public static assets.
    "/((?!api/auth/login|_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon|manifest\\.webmanifest|robots\\.txt).*)",
  ],
};
