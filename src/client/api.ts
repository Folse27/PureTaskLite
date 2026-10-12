"use client";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

/** fetch wrapper for our JSON API. Redirects to /login when the session is gone. */
export async function api<T>(path: string, { method, body, form, signal }: Options = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: method ?? (body !== undefined || form ? "POST" : "GET"),
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiError(0, "You appear to be offline.");
  }

  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    // Full reload on purpose: the session is gone, so drop all client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
    throw new ApiError(401, "Signed out.");
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(response.status, (data.error as string) || `Request failed (${response.status}).`, data);
  }
  return data as T;
}
