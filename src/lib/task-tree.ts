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
