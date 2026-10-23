import type { Task } from "./types";

/** Direct children of `parentId` (null = top level) in display order. */
export function childrenOf(tasks: readonly Task[], parentId: string | null): Task[] {
  return tasks
    .filter((t) => t.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

/** Ids of a task and all its descendants. */
export function subtreeIds(tasks: readonly Task[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tasks) {
      if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
        ids.add(t.id);
        grew = true;
      }
    }
  }
  return ids;
}

export const countTopLevel = (tasks: readonly Task[]) => tasks.reduce((n, t) => n + (t.parentId ? 0 : 1), 0);

/** Applies a new sibling order (ids) by rewriting sortOrder. */
export function applyOrder(tasks: readonly Task[], orderedIds: readonly string[]): Task[] {
  const index = new Map(orderedIds.map((id, i) => [id, i]));
  return tasks.map((t) => (index.has(t.id) ? { ...t, sortOrder: index.get(t.id)! } : t));
}

/**
 * Sibling order after a priority change: by priority (in the user's priority
 * order, no priority last), keeping the current order among equal priorities.
 * Applied once when a priority changes — tasks stay freely movable afterwards.
 */
export function priorityOrder(siblings: readonly Task[], priorityIds: readonly string[]): string[] {
  const rank = (t: Task) => {
    const i = t.priorityId ? priorityIds.indexOf(t.priorityId) : -1;
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  return [...siblings]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
    .sort((a, b) => rank(a) - rank(b)) // stable: equal priorities keep their order
    .map((t) => t.id);
}

/** Re-sorts the sibling group of `taskId` by priority (see priorityOrder). */
export function resortByPriority(tasks: readonly Task[], taskId: string, priorityIds: readonly string[]): Task[] {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return [...tasks];
  return applyOrder(tasks, priorityOrder(childrenOf(tasks, task.parentId), priorityIds));
}

/** How many levels a task's subtree reaches below it (0 for a task without sub-notes). */
export function subtreeHeight(tasks: readonly Task[], rootId: string): number {
  const root = tasks.find((t) => t.id === rootId);
  if (!root) return 0;
  const ids = subtreeIds(tasks, rootId);
  return Math.max(...tasks.filter((t) => ids.has(t.id)).map((t) => t.depth)) - root.depth;
}

export interface MoveTarget {
  /** New parent, or null for a top-level task on `date`. */
  parentId: string | null;
  date: string;
  /** Position among the new siblings (the moved task excluded). */
  index: number;
}

/**
 * Whether `id` (with its sub-notes) may move under `parentId`: not into its
 * own subtree, and not deeper than the depth limit allows.
 */
export function canMoveTo(tasks: readonly Task[], id: string, parentId: string | null, maxDepth: number): boolean {
  if (parentId === null) return true;
  if (subtreeIds(tasks, id).has(parentId)) return false;
  const parent = tasks.find((t) => t.id === parentId);
  if (!parent) return false;
  return parent.depth + 1 + subtreeHeight(tasks, id) <= maxDepth;
}

/**
 * Moves a task and its sub-notes to a new parent/day/position. `tasks` must
 * contain both the source and target days; returns the updated list.
 */
export function applyMove(tasks: readonly Task[], id: string, to: MoveTarget): Task[] {
  const root = tasks.find((t) => t.id === id);
  if (!root) return [...tasks];
  const parent = to.parentId ? tasks.find((t) => t.id === to.parentId) : undefined;
  const date = parent?.date ?? to.date;
  const delta = (parent ? parent.depth + 1 : 0) - root.depth;
  const moving = subtreeIds(tasks, id);

  const moved = tasks.map((t) =>
    moving.has(t.id) ? { ...t, date, depth: t.depth + delta, ...(t.id === id ? { parentId: to.parentId } : {}) } : t,
  );
  const inGroup = (t: Task) => t.parentId === to.parentId && (to.parentId !== null || t.date === date);
  const siblings = childrenOf(
    moved.filter((t) => inGroup(t) && t.id !== id),
    to.parentId,
  ).map((t) => t.id);
  const index = Math.max(0, Math.min(to.index, siblings.length));
  siblings.splice(index, 0, id);
  return applyOrder(moved, siblings);
}
