"use client";

import { useEffect, useRef, useState } from "react";
import { formatWait } from "@/lib/auth/rate-limit";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);

  const remaining = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const locked = remaining > 0;

  useEffect(() => {
    if (!lockedUntil) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        setLockedUntil(null);
        setError(null);
        input.current?.focus();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        window.location.replace(next);
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; retryAfterSeconds?: number };
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After")) || data.retryAfterSeconds || 60;
        setNow(Date.now());
        setLockedUntil(Date.now() + seconds * 1000);
        setError(data.error?.replace(/Try again in .*$/, "").trim() || "Too many attempts.");
      } else {
        setError(data.error || "Wrong password");
      }
      setPassword("");
      input.current?.focus();
    } catch {
      setError("Couldn’t reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full max-w-[360px]" noValidate>
      <div className="mb-8 flex flex-col items-center text-center">
        <div
          className="mb-5 flex size-[72px] items-center justify-center rounded-[18px] bg-accent-fill text-white shadow-float"
          aria-hidden="true"
        >
          <svg
            width="38"
            height="38"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
            <path d="M3.5 10h17M8 3v4M16 3v4M8.5 15l2.2 2.2L15.5 13" />
          </svg>
        </div>
        <h1 className="text-[28px] font-bold tracking-[-0.025em]">PureTask Lite</h1>
        <p className="mt-1 text-[15px] text-label-2">Enter your password to continue.</p>
      </div>

      <label htmlFor="password" className="sr-only">
        Password
      </label>
      <input
        ref={input}
        id="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={locked}
        aria-invalid={!!error}
        aria-describedby="login-message"
        placeholder="Password"
        className="h-[50px] w-full rounded-xl bg-surface px-4 text-[17px] text-label shadow-soft outline-none ring-1 ring-separator placeholder:text-label-3 focus:ring-2 focus:ring-accent disabled:opacity-60"
      />

      <p
        id="login-message"
        role="alert"
        aria-live="assertive"
        className="min-h-[44px] px-1 pt-2.5 text-[14px] leading-snug text-danger"
      >
        {error}
        {locked && (
          <>
            {" "}
            Try again in <span className="tabular font-semibold">{formatWait(remaining)}</span>.
          </>
        )}
      </p>

      <button
        type="submit"
        disabled={busy || locked || !password}
        className="pressable h-[50px] w-full rounded-xl bg-accent-fill text-[17px] font-semibold text-white shadow-soft disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
