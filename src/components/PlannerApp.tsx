"use client";

import { format } from "date-fns";
import { useEffect, useState } from "react";
import { useTheme, useToday } from "@/client/hooks";
import { usePlanner } from "@/client/planner-store";
import { revealToday } from "@/client/reveal";
import { useUi } from "@/client/ui-store";
import { hydrateAssistant } from "@/client/voice/assistant-store";
import { unlockSpeech } from "@/client/voice/speech";
import { fromISODate } from "@/lib/dates";
import type { Label } from "@/lib/types";
import { AssistantDock } from "./AssistantDock";
import { CalendarToday, Gear, Moon, Sun } from "./icons";
import { SettingsSheet } from "./SettingsSheet";
import { CalendarTree } from "./tree/CalendarTree";
import { ConfirmHost } from "./ui/ConfirmHost";
import { Toaster } from "./ui/Toaster";

interface InitialData {
  statuses: Label[];
  priorities: Label[];
  counts: Record<string, number>;
}

export function PlannerApp({ initial }: { initial: InitialData }) {
  const today = useToday();
  const hydrated = useUi((s) => s.hydrated);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    usePlanner.getState().init(initial);
    useUi.getState().hydrate();
    hydrateAssistant();
    // iOS: speech may only start inside a user gesture — unlock it on the first tap.
    const unlock = () => unlockSpeech();
    document.addEventListener("click", unlock, { once: true, capture: true });
    return () => document.removeEventListener("click", unlock, { capture: true });
  }, [initial]);

  // Pick up changes made elsewhere when coming back to the tab.
  useEffect(() => {
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 60_000) {
        last = Date.now();
        void usePlanner.getState().refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return (
    <div className="planner min-h-dvh">
      <Header today={today} onSettings={() => setSettingsOpen(true)} />
      <main
        className="mx-auto max-w-3xl pb-40 pt-2"
        style={{
          paddingLeft: "max(16px, env(safe-area-inset-left))",
          paddingRight: "max(16px, env(safe-area-inset-right))",
        }}
      >
        <div className="mb-5 mt-3 px-1">
          <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.03em]">Planner</h1>
          <p className="mt-1 text-[15px] text-label-2">{format(fromISODate(today), "EEEE, d MMMM yyyy")}</p>
        </div>
        {hydrated ? <CalendarTree today={today} /> : <TreeSkeleton />}
      </main>
      <AssistantDock today={today} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ConfirmHost />
      <Toaster />
    </div>
  );
}

function Header({ today, onSettings }: { today: string; onSettings: () => void }) {
  const { resolved, setChoice } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`material sticky top-0 z-20 transition-shadow duration-200 ${
        scrolled ? "shadow-[0_0.5px_0_var(--separator)]" : ""
      }`}
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div
        className="mx-auto flex h-14 max-w-3xl items-center gap-1"
        style={{
          paddingLeft: "max(16px, env(safe-area-inset-left))",
          paddingRight: "max(8px, env(safe-area-inset-right))",
        }}
      >
        <span
          className={`flex-1 text-[17px] font-semibold tracking-[-0.01em] transition-opacity duration-200 ${
            scrolled ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden={!scrolled}
        >
          Planner
        </span>
        <button
          type="button"
          onClick={() => void revealToday(today)}
          className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[15px] font-semibold text-accent hover:bg-accent-tint"
        >
          <CalendarToday size={19} />
          Today
        </button>
        <button
          type="button"
          onClick={() => setChoice(resolved === "dark" ? "light" : "dark")}
          aria-label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="pressable flex size-11 items-center justify-center rounded-full text-label-2 hover:bg-fill"
        >
          {resolved === "dark" ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <button
          type="button"
          onClick={onSettings}
          aria-label="Settings"
          className="pressable flex size-11 items-center justify-center rounded-full text-label-2 hover:bg-fill"
        >
          <Gear size={20} />
        </button>
      </div>
    </header>
  );
}

function TreeSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-11 w-28 animate-pulse rounded-lg bg-fill motion-reduce:animate-none" />
      ))}
    </div>
  );
}
