"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { todayISO } from "@/lib/dates";

/** Today's date in Europe/Berlin; updates at midnight and when the tab regains focus. */
export function useToday(): string {
  const [today, setToday] = useState(() => todayISO());
  useEffect(() => {
    const update = () => setToday(todayISO());
    const timer = setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return today;
}

export function useMediaQuery(query: string, serverFallback = false): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => serverFallback,
  );
}

/** Fine pointer + hover: a mouse/trackpad, where drag handles make sense. */
export const useFinePointer = () => useMediaQuery("(hover: hover) and (pointer: fine)");

const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP_PX = 12;

/**
 * Double-click for mouse, and an explicit double-tap detector for touch/pen
 * (mobile browsers don't reliably fire `dblclick` for taps). Spread the
 * returned handlers on the target element.
 */
export function useDoubleActivate(onActivate: () => void, enabled = true) {
  const last = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastPointerType = useRef<string>("mouse");
  const down = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    lastPointerType.current = e.pointerType;
    down.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.pointerType === "mouse") return;
      const start = down.current;
      // Ignore scrolls/drags: the finger must lift close to where it went down.
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > DOUBLE_TAP_SLOP_PX) {
        last.current = null;
        return;
      }
      const now = e.timeStamp;
      const prev = last.current;
      if (
        prev &&
        now - prev.time < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_SLOP_PX * 2
      ) {
        last.current = null;
        e.preventDefault();
        onActivate();
      } else {
        last.current = { time: now, x: e.clientX, y: e.clientY };
      }
    },
    [enabled, onActivate],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Touch double-taps are handled above; some browsers also emit dblclick for them.
      if (!enabled || lastPointerType.current !== "mouse") return;
      e.preventDefault();
      onActivate();
    },
    [enabled, onActivate],
  );

  return { onPointerDown, onPointerUp, onDoubleClick };
}

export type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "ptl-theme";

function readThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function applyTheme(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", dark ? "#000000" : "#f2f2f7");
  });
}

const themeListeners = new Set<() => void>();

/** Theme preference: follows the system until the user picks one, which is remembered. */
export function useTheme() {
  const choice = useSyncExternalStore(
    (notify) => {
      themeListeners.add(notify);
      return () => themeListeners.delete(notify);
    },
    readThemeChoice,
    () => "system" as ThemeChoice,
  );
  const resolved = useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => observer.disconnect();
    },
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    () => "light" as const,
  );

  useEffect(() => {
    if (choice !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
    applyTheme(next);
    themeListeners.forEach((l) => l());
  }, []);

  return { choice, resolved, setChoice };
}
