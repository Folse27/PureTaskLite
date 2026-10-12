"use client";

import { create } from "zustand";
import { MAX_EXTRA_YEARS } from "@/lib/dates";
import { readStorage, writeStorage } from "./storage";

const STORAGE_KEY = "ptl-tree-v1";

/**
 * Tree UI state. Node keys: "y:2026", "m:2026-10", "w:<monday>", "d:<date>".
 * Tasks are expanded by default, so only collapsed task ids are remembered.
 */
interface UiState {
  hydrated: boolean;
  expanded: Record<string, true>;
  collapsedTasks: Record<string, true>;
  extraYears: number;
  /** Roving tabindex target in the tree. */
  activeKey: string | null;
  /** Node currently flashing (Today button / assistant links). */
  flash: { key: string; nonce: number } | null;

  hydrate: () => void;
  isExpanded: (key: string) => boolean;
  toggle: (key: string) => void;
  setExpanded: (key: string, open: boolean) => void;
  expandMany: (keys: string[]) => void;
  toggleTask: (id: string) => void;
  setTaskExpanded: (id: string, open: boolean) => void;
  addYear: () => void;
  ensureYearVisible: (extra: number) => void;
  setActive: (key: string) => void;
  flashNode: (key: string) => void;
}

type Persisted = Pick<UiState, "expanded" | "collapsedTasks" | "extraYears">;

export const useUi = create<UiState>((set, get) => ({
  hydrated: false,
  expanded: {},
  collapsedTasks: {},
  extraYears: 0,
  activeKey: null,
  flash: null,

  hydrate: () => {
    const saved = readStorage<Partial<Persisted>>(STORAGE_KEY, {});
    set({
      hydrated: true,
      expanded: saved.expanded && typeof saved.expanded === "object" ? saved.expanded : {},
      collapsedTasks: saved.collapsedTasks && typeof saved.collapsedTasks === "object" ? saved.collapsedTasks : {},
      extraYears: Math.min(Math.max(Number(saved.extraYears) || 0, 0), MAX_EXTRA_YEARS),
    });
  },
  isExpanded: (key) => !!get().expanded[key],
  toggle: (key) => get().setExpanded(key, !get().expanded[key]),
  setExpanded: (key, open) => {
    const expanded = { ...get().expanded };
    if (open) expanded[key] = true;
    else delete expanded[key];
    set({ expanded });
  },
  expandMany: (keys) => {
    const expanded = { ...get().expanded };
    for (const key of keys) expanded[key] = true;
    set({ expanded });
  },
  toggleTask: (id) => get().setTaskExpanded(id, !!get().collapsedTasks[id]),
  setTaskExpanded: (id, open) => {
    const collapsedTasks = { ...get().collapsedTasks };
    if (open) delete collapsedTasks[id];
    else collapsedTasks[id] = true;
    set({ collapsedTasks });
  },
  addYear: () => set({ extraYears: Math.min(get().extraYears + 1, MAX_EXTRA_YEARS) }),
  ensureYearVisible: (extra) => {
    if (extra > get().extraYears) set({ extraYears: Math.min(extra, MAX_EXTRA_YEARS) });
  },
  setActive: (key) => {
    if (get().activeKey !== key) set({ activeKey: key });
  },
  flashNode: (key) => set({ flash: { key, nonce: Date.now() } }),
}));

// Persist (debounced). Storage failures are ignored.
let timer: ReturnType<typeof setTimeout> | undefined;
useUi.subscribe((state, prev) => {
  if (!state.hydrated) return;
  if (
    state.expanded === prev.expanded &&
    state.collapsedTasks === prev.collapsedTasks &&
    state.extraYears === prev.extraYears
  ) {
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { expanded, collapsedTasks, extraYears } = useUi.getState();
    writeStorage(STORAGE_KEY, { expanded, collapsedTasks, extraYears } satisfies Persisted);
  }, 150);
});

export const yearKey = (year: number) => `y:${year}`;
export const monthKey = (year: number, monthIndex: number) => `m:${year}-${String(monthIndex + 1).padStart(2, "0")}`;
export const weekKey = (monday: string) => `w:${monday}`;
export const dayKey = (date: string) => `d:${date}`;
export const taskKey = (id: string) => `t:${id}`;
