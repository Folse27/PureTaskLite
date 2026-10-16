"use client";

import { create } from "zustand";
import { daysOfWeek, weekEnd, weekStartOf } from "@/lib/dates";
import { applyMove, applyOrder, countTopLevel, resortByPriority, subtreeIds, type MoveTarget } from "@/lib/task-tree";
import type { Label, LabelKind, Task, TaskPatch } from "@/lib/types";
import { api, ApiError } from "./api";
import { toast } from "./toast-store";
import { useUi, weekKey } from "./ui-store";

/**
 * Client cache of the planner. Tasks are loaded per week (when a week is
 * expanded); badge counts for weeks that aren't loaded come from the server.
 * Every mutation is applied optimistically and rolled back on failure.
 */
interface PlannerState {
  statuses: Label[];
  priorities: Label[];
  /** Top-level task counts per date (server snapshot, used for unloaded dates). */
  counts: Record<string, number>;
  /** All tasks (incl. sub-notes) of loaded dates. Every day of a loaded week has an entry. */
  tasksByDate: Record<string, Task[]>;
  loadedWeeks: Record<string, true>;

  init: (data: { statuses: Label[]; priorities: Label[]; counts: Record<string, number> }) => void;
  loadWeek: (monday: string, force?: boolean) => Promise<void>;
  refresh: () => Promise<void>;

  createTask: (input: {
    date: string;
    title: string;
    parentId?: string | null;
  }) => Promise<void>;
  updateTask: (id: string, patch: TaskPatch) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  reorderSiblings: (date: string, parentId: string | null, orderedIds: string[]) => Promise<void>;
  /** Move a task (with its sub-notes) to another parent, day or position. */
  moveTask: (id: string, to: MoveTarget) => Promise<void>;

  createLabel: (kind: LabelKind, name: string, color: string) => Promise<Label | null>;
  updateLabel: (kind: LabelKind, id: string, patch: { name?: string; color?: string }) => Promise<void>;
  reorderLabels: (kind: LabelKind, orderedIds: string[]) => Promise<void>;
  /** Resolves "in-use" with the usage count when tasks still reference the label. */
  deleteLabel: (kind: LabelKind, id: string, reassignTo?: string) => Promise<{ inUse: number } | "deleted" | "failed">;
}

type Snapshot = Pick<PlannerState, "statuses" | "priorities" | "counts" | "tasksByDate">;

const inFlightWeeks = new Map<string, Promise<void>>();
let tempCounter = 0;
export const isTempId = (id: string) => id.startsWith("tmp-");

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError && error.status !== 500 && error.message ? error.message : fallback;
}

export function findTask(state: Pick<PlannerState, "tasksByDate">, id: string): Task | undefined {
  for (const list of Object.values(state.tasksByDate)) {
    const found = list.find((t) => t.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Badge count for a date: live from loaded tasks, otherwise from the server snapshot. */
export function countForDate(state: Pick<PlannerState, "tasksByDate" | "counts">, date: string): number {
  const loaded = state.tasksByDate[date];
  return loaded ? countTopLevel(loaded) : (state.counts[date] ?? 0);
}

export const usePlanner = create<PlannerState>((set, get) => {
  const snapshot = (): Snapshot => {
    const { statuses, priorities, counts, tasksByDate } = get();
    return { statuses, priorities, counts, tasksByDate };
  };

  /** Apply `change` now; if `request` fails, restore and tell the user. */
  async function optimistic<T>(
    change: (s: PlannerState) => Partial<PlannerState>,
    request: () => Promise<T>,
    failure: string,
  ): Promise<T | undefined> {
    const before = snapshot();
    set(change(get()));
    try {
      return await request();
    } catch (error) {
      set(before);
      toast(`${errorMessage(error, failure)} Your change was undone.`);
      return undefined;
    }
  }

  const setDate = (s: PlannerState, date: string, tasks: Task[]) => ({
    tasksByDate: { ...s.tasksByDate, [date]: tasks },
  });

  return {
    statuses: [],
    priorities: [],
    counts: {},
    tasksByDate: {},
    loadedWeeks: {},

    init: ({ statuses, priorities, counts }) => set({ statuses, priorities, counts }),

    loadWeek: async (monday, force = false) => {
      if (!force && get().loadedWeeks[monday]) return;
      const pending = inFlightWeeks.get(monday);
      if (pending && !force) return pending;
      const run = (async () => {
        try {
          const { tasks } = await api<{ tasks: Task[] }>(`/api/tasks?from=${monday}&to=${weekEnd(monday)}`);
          const byDate: Record<string, Task[]> = {};
          for (const day of daysOfWeek(monday)) byDate[day] = [];
          for (const t of tasks) byDate[t.date]?.push(t);
          set((s) => ({
            tasksByDate: { ...s.tasksByDate, ...byDate },
            loadedWeeks: { ...s.loadedWeeks, [monday]: true },
          }));
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 401)) {
            toast(errorMessage(error, "Couldn't load this week."));
          }
        } finally {
          inFlightWeeks.delete(monday);
        }
      })();
      inFlightWeeks.set(monday, run);
      return run;
    },

    refresh: async () => {
      try {
        const [{ counts }, { labels: statuses }, { labels: priorities }] = await Promise.all([
          api<{ counts: Record<string, number> }>("/api/tasks/counts"),
          api<{ labels: Label[] }>("/api/labels/statuses"),
          api<{ labels: Label[] }>("/api/labels/priorities"),
        ]);
        // Refetch only weeks that are open; forget the rest (they reload lazily when reopened,
        // and their badges use the fresh counts). Keeps refresh cost flat over a long session.
        const expanded = useUi.getState().expanded;
        const open = Object.keys(get().loadedWeeks).filter((monday) => expanded[weekKey(monday)]);
        set((s) => {
          const tasksByDate = { ...s.tasksByDate };
          const loadedWeeks: Record<string, true> = {};
          for (const monday of Object.keys(s.loadedWeeks)) {
            if (expanded[weekKey(monday)]) loadedWeeks[monday] = true;
            else for (const day of daysOfWeek(monday)) delete tasksByDate[day];
          }
          return { counts, statuses, priorities, tasksByDate, loadedWeeks };
        });
        await Promise.all(open.map((monday) => get().loadWeek(monday, true)));
      } catch (error) {
        toast(errorMessage(error, "Couldn't refresh the plan."));
      }
    },

    createTask: async ({ date, title, parentId = null }) => {
      const parent = parentId ? findTask(get(), parentId) : undefined;
      const targetDate = parent?.date ?? date;
      const siblings = (get().tasksByDate[targetDate] ?? []).filter((t) => t.parentId === parentId);
      const now = new Date().toISOString();
      const temp: Task = {
        id: `tmp-${++tempCounter}`,
        date: targetDate,
        parentId,
        depth: parent ? parent.depth + 1 : 0,
        title,
        description: null,
        statusId: get().statuses[0]?.id ?? null,
        priorityId: null,
        sortOrder: siblings.reduce((m, t) => Math.max(m, t.sortOrder), -1) + 1,
        createdAt: now,
        updatedAt: now,
      };
      const created = await optimistic(
        (s) => setDate(s, targetDate, [...(s.tasksByDate[targetDate] ?? []), temp]),
        () => api<{ task: Task }>("/api/tasks", { body: { date: targetDate, title, parentId } }),
        "Couldn't add the task.",
      );
      if (created) {
        set((s) =>
          setDate(
            s,
            targetDate,
            (s.tasksByDate[targetDate] ?? []).map((t) => (t.id === temp.id ? created.task : t)),
          ),
        );
      }
    },

    updateTask: async (id, patch) => {
      const current = findTask(get(), id);
      if (!current) return;
      const moving = patch.date !== undefined && patch.date !== current.date;

      await optimistic(
        (s) => {
          const list = s.tasksByDate[current.date] ?? [];
          if (!moving) {
            let updated = list.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t));
            // A new priority sorts the task among its siblings once (mirrors the server).
            if (patch.priorityId !== undefined) {
              updated = resortByPriority(updated, id, s.priorities.map((p) => p.id));
            }
            return setDate(s, current.date, updated);
          }
          // Move the task and its sub-notes; the task becomes top-level on the new day.
          const ids = subtreeIds(list, id);
          const target = patch.date!;
          const moved = list
            .filter((t) => ids.has(t.id))
            .map((t) =>
              t.id === id
                ? { ...t, ...patch, parentId: null, depth: 0, sortOrder: Number.MAX_SAFE_INTEGER }
                : { ...t, date: target, depth: t.depth - current.depth },
            );
          const tasksByDate = { ...s.tasksByDate, [current.date]: list.filter((t) => !ids.has(t.id)) };
          const counts = { ...s.counts };
          if (s.tasksByDate[target]) tasksByDate[target] = [...s.tasksByDate[target], ...moved];
          else counts[target] = (counts[target] ?? 0) + 1;
          return { tasksByDate, counts };
        },
        () => api(`/api/tasks/${id}`, { method: "PATCH", body: patch }),
        moving ? "Couldn't move the task." : "Couldn't save the change.",
      );

      if (moving) {
        // Pick up the server's sort order for the moved subtree.
        const monday = weekStartOf(patch.date!);
        if (get().loadedWeeks[monday]) void get().loadWeek(monday, true);
      }
    },

    deleteTask: async (id) => {
      const current = findTask(get(), id);
      if (!current) return;
      await optimistic(
        (s) => {
          const list = s.tasksByDate[current.date] ?? [];
          const ids = subtreeIds(list, id);
          return setDate(s, current.date, list.filter((t) => !ids.has(t.id)));
        },
        () => api(`/api/tasks/${id}`, { method: "DELETE" }),
        "Couldn't delete the task.",
      );
    },

    reorderSiblings: async (date, parentId, orderedIds) => {
      await optimistic(
        (s) => setDate(s, date, applyOrder(s.tasksByDate[date] ?? [], orderedIds)),
        () => api("/api/tasks/reorder", { body: { date, parentId, orderedIds } }),
        "Couldn't save the new order.",
      );
    },

    moveTask: async (id, to) => {
      const current = findTask(get(), id);
      if (!current) return;
      const parent = to.parentId ? findTask(get(), to.parentId) : undefined;
      const targetDate = parent?.date ?? to.date;
      await optimistic(
        (s) => {
          const source = s.tasksByDate[current.date] ?? [];
          const target = targetDate === current.date ? [] : (s.tasksByDate[targetDate] ?? []);
          const moved = applyMove([...source, ...target], id, { ...to, date: targetDate });
          const tasksByDate = { ...s.tasksByDate, [current.date]: moved.filter((t) => t.date === current.date) };
          const counts = { ...s.counts };
          if (targetDate !== current.date) {
            if (s.tasksByDate[targetDate]) tasksByDate[targetDate] = moved.filter((t) => t.date === targetDate);
            else if (!to.parentId) counts[targetDate] = (counts[targetDate] ?? 0) + 1;
          }
          return { tasksByDate, counts };
        },
        () => api("/api/tasks/move", { body: { id, parentId: to.parentId, date: targetDate, index: to.index } }),
        "Couldn't move the task.",
      );
    },

    createLabel: async (kind, name, color) => {
      try {
        const { label } = await api<{ label: Label }>(`/api/labels/${kind}`, { body: { name, color } });
        set((s) => ({ [kind]: [...s[kind], label] }) as Partial<PlannerState>);
        return label;
      } catch (error) {
        toast(errorMessage(error, "Couldn't add it."));
        return null;
      }
    },

    updateLabel: async (kind, id, patch) => {
      await optimistic(
        (s) => ({ [kind]: s[kind].map((l) => (l.id === id ? { ...l, ...patch } : l)) }) as Partial<PlannerState>,
        () => api(`/api/labels/${kind}/${id}`, { method: "PATCH", body: patch }),
        "Couldn't save the change.",
      );
    },

    reorderLabels: async (kind, orderedIds) => {
      await optimistic(
        (s) => {
          const byId = new Map(s[kind].map((l) => [l.id, l]));
          return {
            [kind]: orderedIds.map((labelId, i) => ({ ...byId.get(labelId)!, sortOrder: i })),
          } as Partial<PlannerState>;
        },
        () => api(`/api/labels/${kind}/reorder`, { body: { orderedIds } }),
        "Couldn't save the new order.",
      );
    },

    deleteLabel: async (kind, id, reassignTo) => {
      const query = reassignTo ? `?reassignTo=${encodeURIComponent(reassignTo)}` : "";
      const before = snapshot();
      const field = kind === "statuses" ? "statusId" : "priorityId";
      const target = reassignTo && reassignTo !== "none" ? reassignTo : null;
      set((s) => {
        const tasksByDate: Record<string, Task[]> = {};
        for (const [date, list] of Object.entries(s.tasksByDate)) {
          tasksByDate[date] = list.map((t) => (t[field] === id ? { ...t, [field]: target } : t));
        }
        return { [kind]: s[kind].filter((l) => l.id !== id), tasksByDate } as Partial<PlannerState>;
      });
      try {
        await api(`/api/labels/${kind}/${id}${query}`, { method: "DELETE" });
        return "deleted";
      } catch (error) {
        set(before);
        if (error instanceof ApiError && error.status === 409 && typeof error.data.inUse === "number") {
          return { inUse: error.data.inUse };
        }
        toast(errorMessage(error, "Couldn't delete it."));
        return "failed";
      }
    },
  };
});
