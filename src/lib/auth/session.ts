/**
 * Stateless signed session tokens: "v1.<expiresAtSeconds>.<hmacSha256Base64url>".
 *
 * Uses Web Crypto only, so it runs the same in the proxy and in route handlers.
 * Verification goes through `crypto.subtle.verify`, which compares in constant time.
 */

export const SESSION_COOKIE = "ptl_session";
/** ~1 year. Browsers cap cookie lifetime at 400 days. */
export const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const VERSION = "v1";

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function createSessionToken(
  secret: string,
  nowMs: number = Date.now(),
  maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS,
): Promise<string> {
  const expiresAt = Math.floor(nowMs / 1000) + maxAgeSeconds;
  const payload = `${VERSION}.${expiresAt}`;
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || !/^\d{1,12}$/.test(parts[1])) return false;
  const signature = fromBase64Url(parts[2]);
  if (!signature) return false;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await importKey(secret),
    signature,
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  return valid && Number(parts[1]) * 1000 > nowMs;
}
